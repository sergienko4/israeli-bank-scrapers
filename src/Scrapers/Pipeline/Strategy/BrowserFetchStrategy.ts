/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Wraps fetchPostWithinPage/fetchGetWithinPage from Common/Fetch.ts.
 * Returns Procedure<T> — never throws.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../Base/Interface.js';
import type { IBankScraperConfig } from '../../Registry/Config/ScraperConfigDefaults.js';
import { getDebug } from '../Types/Debug.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import { fetchGetWithinPage, fetchGetWithinPageWithHeaders, fetchPostWithinPage } from './Fetch.js';
import type {
  IFetchOpts,
  IFetchStrategy,
  ProxyReqName,
  SessionActivated,
} from './FetchStrategy.js';

const LOG = getDebug('browser-fetch-strategy');

/**
 * Build a failure for an empty fetch response.
 * @param url - The URL that returned empty.
 * @returns A Generic failure Procedure.
 */
function emptyResponseError(url: string): Procedure<never> {
  const truncated = url.slice(-80);
  return fail(ScraperErrorTypes.Generic, `Fetch returned empty response: ${truncated}`);
}

/**
 * Convert a nullable fetch result to a Procedure.
 * @param result - The fetch result (falsy if empty).
 * @param url - The URL for error reporting.
 * @returns Succeed with data, or empty-response failure.
 */
function resultToProcedure<T>(result: unknown, url: string): Procedure<T> {
  if (result) return succeed(result as T);
  return emptyResponseError(url) as Procedure<T>;
}

/**
 * Build a failure from a caught fetch exception.
 * @param error - The caught error.
 * @returns A Generic failure Procedure.
 */
function catchError(error: unknown): Procedure<never> {
  const message = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, message);
}

/** Server response status code from .ashx proxy ('1' = success). */
type AshxStatus = string;
/** Resolved user name from ValidateIdData (may be empty). */
type AshxUserName = string;
/** Full URL to ProxyRequestHandler.ashx endpoint. */
type ProxyEndpointUrl = string;

/** Validation response shape from ProxyRequestHandler.ashx. */
interface IValidateResponse {
  readonly Header: { readonly Status: AshxStatus };
  readonly ValidateIdDataBean?: { readonly userName?: AshxUserName };
}

/** Bundled args for session activation via .ashx proxy. */
interface IActivationArgs {
  readonly page: Page;
  readonly servicesUrl: ProxyEndpointUrl;
  readonly credentials: ScraperCredentials;
  readonly config: IBankScraperConfig;
}

/**
 * Activate server-side session via .ashx proxy (ValidateIdData + performLogon).
 * @param args - Bundled activation arguments (page, servicesUrl, credentials, config).
 * @returns Succeed(true) if activated, fail if rejected.
 */
async function activateViaProxy(args: IActivationArgs): Promise<Procedure<SessionActivated>> {
  const { page, servicesUrl, credentials, config } = args;
  const auth = config.auth;
  const creds = credentials as Record<string, string>;
  // Step 1: ValidateIdData
  const validateUrl = `${servicesUrl}?reqName=ValidateIdData`;
  const credId = creds.id || '';
  const credCard = creds.card6Digits || '';
  const validateBody = {
    id: credId,
    cardSuffix: credCard,
    countryCode: auth.countryCode,
    idType: auth.idType,
    checkLevel: auth.checkLevel,
    companyCode: auth.companyCode,
  };
  LOG.debug('[ACTIVATION] ValidateIdData POST to %s', validateUrl);
  const validateResult = await fetchPostWithinPage<IValidateResponse>(page, validateUrl, {
    data: validateBody,
  }).catch((): IValidateResponse | false => false);
  if (!validateResult)
    return fail(ScraperErrorTypes.Generic, 'ACTIVATION: ValidateIdData fetch failed');
  const headerStatus = validateResult.Header.Status;
  LOG.debug('[ACTIVATION] ValidateIdData Status=%s', headerStatus);
  if (headerStatus !== '1')
    return fail(ScraperErrorTypes.Generic, `ACTIVATION: ValidateIdData rejected (${headerStatus})`);
  const bean = validateResult.ValidateIdDataBean;
  const userName = bean?.userName ?? '';
  // Step 2: performLogon (reqName from config — e.g., 'performLogonI')
  const loginReqName = auth.loginReqName ?? 'performLogon';
  const loginUrl = `${servicesUrl}?reqName=${loginReqName}`;
  const credPassword = creds.password || '';
  const loginBody = {
    KodMishtamesh: userName,
    MisparZihuy: credId,
    Sisma: credPassword,
    cardSuffix: credCard,
    countryCode: auth.countryCode,
    idType: auth.idType,
  };
  LOG.debug('[ACTIVATION] performLogon POST to %s', loginUrl);
  const loginResult = await fetchPostWithinPage<Record<string, unknown>>(page, loginUrl, {
    data: loginBody,
  }).catch((): false => false);
  if (!loginResult) return fail(ScraperErrorTypes.Generic, 'ACTIVATION: performLogon fetch failed');
  LOG.debug('[ACTIVATION] performLogon completed');
  return succeed(true);
}

/** Browser fetch — delegates to fetchPostWithinPage/fetchGetWithinPage. */
class BrowserFetchStrategy implements IFetchStrategy {
  private readonly _page: Page;

  /**
   * Create a BrowserFetchStrategy.
   * @param page - The Playwright page for fetch context.
   */
  constructor(page: Page) {
    this._page = page;
  }

  /**
   * POST via browser page session.
   * @param url - Target URL.
   * @param data - POST body key-value pairs.
   * @param opts - Optional fetch config (extraHeaders).
   * @returns Procedure with parsed response or failure.
   */
  public async fetchPost<T>(
    url: string,
    data: Record<string, string>,
    opts: IFetchOpts,
  ): Promise<Procedure<T>> {
    return fetchPostWithinPage<T>(this._page, url, { data, extraHeaders: opts.extraHeaders })
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * GET via browser page session.
   * @param url - Target URL.
   * @param opts - Optional fetch config (extraHeaders).
   * @returns Procedure with parsed response or failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const hasHeaders = Object.keys(opts.extraHeaders).length > 0;
    if (!hasHeaders) {
      return fetchGetWithinPage<T>(this._page, url, false)
        .then((result): Procedure<T> => resultToProcedure(result, url))
        .catch(catchError);
    }
    return fetchGetWithinPageWithHeaders<T>(this._page, url, opts.extraHeaders)
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * Session activation via .ashx proxy — establishes server-side session.
   * Uses config.auth for companyCode/countryCode/idType/checkLevel (generic, not hardcoded).
   * @param credentials - User credentials (id, password, card6Digits).
   * @param config - Bank config with auth params and api.base URL.
   * @returns Succeed(true) if session activated, fail if auth rejected.
   */
  public async activateSession(
    credentials: ScraperCredentials,
    config: IBankScraperConfig,
  ): Promise<Procedure<SessionActivated>> {
    const baseUrl = config.api.base;
    if (!baseUrl) return fail(ScraperErrorTypes.Generic, 'ACTIVATION: no api.base in config');
    const servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
    return activateViaProxy({ page: this._page, servicesUrl, credentials, config });
  }

  /**
   * Proxy GET — fetch data via .ashx proxy handler on the api.base domain.
   * Constructs URL: config.api.base/services/ProxyRequestHandler.ashx?reqName=...&params
   * @param config - Bank config with api.base URL.
   * @param reqName - The proxy request name (discovered from traffic).
   * @param params - Additional query parameters.
   * @returns Procedure with parsed JSON response.
   */
  public async proxyGet<T>(
    config: IBankScraperConfig,
    reqName: ProxyReqName,
    params: Record<string, string>,
  ): Promise<Procedure<T>> {
    const baseUrl = config.api.base;
    if (!baseUrl) return fail(ScraperErrorTypes.Generic, 'proxyGet: no api.base in config');
    const url = new URL(`${baseUrl}/services/ProxyRequestHandler.ashx`);
    url.searchParams.set('reqName', reqName);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }
    const fullUrl = url.toString();
    LOG.debug('[PROXY] GET %s', fullUrl);
    return fetchGetWithinPage<T>(this._page, fullUrl, false)
      .then((result): Procedure<T> => resultToProcedure(result, fullUrl))
      .catch(catchError);
  }
}

/**
 * Factory: create a BrowserFetchStrategy bound to a page.
 * @param page - The Playwright page for fetch context.
 * @returns IFetchStrategy implementation using browser session.
 */
function createBrowserFetchStrategy(page: Page): IFetchStrategy {
  return new BrowserFetchStrategy(page);
}

export default BrowserFetchStrategy;
export { BrowserFetchStrategy, createBrowserFetchStrategy };
