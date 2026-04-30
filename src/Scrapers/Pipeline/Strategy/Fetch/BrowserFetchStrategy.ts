/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Wraps fetchPostWithinPage/fetchGetWithinPage from Common/Fetch.ts.
 * Returns Procedure<T> — never throws.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../Base/Interface.js';
import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../Mediator/Network/Fetch.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** URL endpoint string. */
type UrlStr = string;
/** Auth identifier string. */
type AuthId = string;

/** Bank config — extends pipeline config with optional proxy fields for Strategy. */
interface IBankConfig {
  readonly urls: { readonly base: UrlStr };
  readonly api?: { readonly base?: UrlStr };
  readonly auth?: {
    readonly loginReqName?: AuthId;
    readonly companyCode?: AuthId;
    readonly countryCode?: AuthId;
    readonly idType?: AuthId;
    readonly checkLevel?: AuthId;
  };
}
type BankConfig = IBankConfig;

import type {
  IFetchOpts,
  IFetchStrategy,
  ProxyReqName,
  SessionActivated,
} from './FetchStrategy.js';

const LOG = getDebug(import.meta.url);

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
/** Nullable fetch result — truthy means data was returned. */
type NullableFetchResult<T> = T | null | false | undefined;

/**
 * Convert a nullable fetch result to a Procedure.
 * @param result - The fetch result (falsy if empty).
 * @param url - The URL for error reporting.
 * @returns Succeed with data, or empty-response failure.
 */
function resultToProcedure<T>(result: NullableFetchResult<T>, url: string): Procedure<T> {
  if (result) return succeed(result as T);
  return emptyResponseError(url);
}

/**
 * Build a failure from a caught fetch exception.
 * @param error - The caught error.
 * @returns A Generic failure Procedure.
 */
function catchError(error: Error): Procedure<never> {
  const message = toErrorMessage(error);
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
  readonly config: BankConfig;
}

/**
 * Activate server-side session via .ashx proxy (ValidateIdData + performLogon).
 * @param args - Bundled activation arguments (page, servicesUrl, credentials, config).
 * @returns Succeed(true) if activated, fail if rejected.
 */
/**
 * Resolve auth fields with defaults for proxy activation.
 * @param auth - Auth config (optional fields).
 * @returns Resolved auth fields as strings.
 */
/** Default auth fields for Isracard-family proxy banks. */
const PROXY_AUTH_DEFAULTS = {
  countryCode: '212',
  idType: '1',
  checkLevel: '1',
  loginReqName: 'performLogonI',
} as const;

/**
 * Resolve auth fields with WK defaults for proxy activation.
 * @param auth - Auth config (may have only companyCode).
 * @returns Resolved auth fields as strings.
 */
function resolveAuthFields(auth: BankConfig['auth']): Record<string, string> {
  if (!auth) return { ...PROXY_AUTH_DEFAULTS, companyCode: '' };
  return {
    countryCode: auth.countryCode ?? PROXY_AUTH_DEFAULTS.countryCode,
    idType: auth.idType ?? PROXY_AUTH_DEFAULTS.idType,
    checkLevel: auth.checkLevel ?? PROXY_AUTH_DEFAULTS.checkLevel,
    companyCode: auth.companyCode ?? '',
    loginReqName: auth.loginReqName ?? PROXY_AUTH_DEFAULTS.loginReqName,
  };
}

/** Sentinel for missing credential fields. */
const ABSENT_CREDENTIAL = '(absent)';

/** Resolved credential triple — id, card suffix, password. */
interface IResolvedCreds {
  readonly id: string;
  readonly cardSuffix: string;
  readonly password: string;
}

/**
 * Resolve required credential fields with the (absent) sentinel for any
 * missing value. Extracted so `activateViaProxy` does not carry three
 * `value || sentinel` short-circuits inline (each one counts toward
 * cyclomatic complexity at the call site).
 * @param creds - Raw credentials record from the scraper API.
 * @returns Resolved credential triple.
 */
function resolveCreds(creds: Record<string, string>): IResolvedCreds {
  return {
    id: creds.id || ABSENT_CREDENTIAL,
    cardSuffix: creds.card6Digits || ABSENT_CREDENTIAL,
    password: creds.password || ABSENT_CREDENTIAL,
  };
}

/** Bundled args for `fetchProxyJson` — respects the 3-param ceiling. */
interface IFetchProxyArgs {
  readonly page: Page;
  readonly url: string;
  readonly body: Record<string, string>;
  readonly failMsg: string;
}

/**
 * Run a same-origin POST inside the page (or matching iframe). Wraps
 * `resolveContext` + `fetchPostWithinPage` + the falsy-result guard
 * into one Procedure so each activation step does not carry the
 * resolve-and-check pair inline. Failure modes: no matching context
 * (returns the resolveContext fail with origin diagnostic) or empty
 * fetch result (returns the supplied failMsg).
 * @param args - Bundled fetch arguments (page, url, body, failMsg).
 * @returns Procedure with parsed JSON or fail.
 */
async function fetchProxyJson<T>(args: IFetchProxyArgs): Promise<Procedure<T>> {
  const ctxResult = resolveContext(args.page, args.url);
  if (!ctxResult.success) return ctxResult;
  const result = await fetchPostWithinPage<T>(ctxResult.value, args.url, {
    data: args.body,
  }).catch((): false => false);
  if (!result) return fail(ScraperErrorTypes.Generic, args.failMsg);
  return succeed(result);
}

/**
 * Activate server-side session via .ashx proxy (ValidateIdData + performLogon).
 * @param args - Bundled activation arguments.
 * @returns Succeed(true) if activated, fail if rejected.
 */
async function activateViaProxy(args: IActivationArgs): Promise<Procedure<SessionActivated>> {
  const { page, servicesUrl, credentials, config } = args;
  const authFields = resolveAuthFields(config.auth);
  const resolved = resolveCreds(credentials as Record<string, string>);
  const validateUrl = `${servicesUrl}?reqName=ValidateIdData`;
  const validateBody = {
    id: resolved.id,
    cardSuffix: resolved.cardSuffix,
    countryCode: authFields.countryCode,
    idType: authFields.idType,
    checkLevel: authFields.checkLevel,
    companyCode: authFields.companyCode,
  };
  LOG.debug({ message: `ValidateIdData POST to ${maskVisibleText(validateUrl)}` });
  const validateProc = await fetchProxyJson<IValidateResponse>({
    page,
    url: validateUrl,
    body: validateBody,
    failMsg: 'ACTIVATION: ValidateIdData fetch failed',
  });
  if (!validateProc.success) return validateProc;
  const validateResult = validateProc.value;
  const headerStatus = validateResult.Header.Status;
  LOG.debug({ message: `ValidateIdData Status=${headerStatus}` });
  if (headerStatus !== '1')
    return fail(ScraperErrorTypes.Generic, `ACTIVATION: ValidateIdData rejected (${headerStatus})`);
  const bean = validateResult.ValidateIdDataBean;
  const userName = bean?.userName ?? ABSENT_CREDENTIAL;
  const loginUrl = `${servicesUrl}?reqName=${authFields.loginReqName}`;
  const loginBody = {
    KodMishtamesh: userName,
    MisparZihuy: resolved.id,
    Sisma: resolved.password,
    cardSuffix: resolved.cardSuffix,
    countryCode: authFields.countryCode,
    idType: authFields.idType,
  };
  LOG.debug({ message: `performLogon POST to ${maskVisibleText(loginUrl)}` });
  const loginProc = await fetchProxyJson<Record<string, unknown>>({
    page,
    url: loginUrl,
    body: loginBody,
    failMsg: 'ACTIVATION: performLogon fetch failed',
  });
  if (!loginProc.success) return loginProc;
  LOG.debug({ message: 'performLogon completed' });
  return succeed(true);
}

/** Whether target origin matches frame. */
type OriginMatch = boolean;

/**
 * True when a frame URL is real (not empty, not about:blank).
 * @param u - Frame URL.
 * @returns Whether to keep this frame in the origins list.
 */
function isRealFrameUrl(u: string): boolean {
  return u.length > 0 && u !== 'about:blank';
}

/**
 * Collect distinct frame origins on the page (skipping about:blank). Used
 * for the diagnostic message when no matching context is found, so the
 * CI failure log shows the real-world frame layout instead of a generic
 * "fetch failed".
 * @param page - Playwright page with attached frames.
 * @returns Comma-joined distinct frame origins (empty when none).
 */
function listFrameOrigins(page: Page): string {
  const urls = page.frames().map((f): string => f.url());
  const real = urls.filter(isRealFrameUrl);
  const origins = real.map((u): string => new URL(u).origin);
  return [...new Set(origins)].join(',');
}

/**
 * Find a same-origin context (page or frame) for the target URL. Returns
 * a Procedure so the caller can fail fast with a diagnostic when neither
 * the main page nor any attached iframe matches the target origin —
 * previously this fell back to the main page silently, which produced a
 * cookieless cross-origin fetch the bank rejected with HTML/empty body
 * (the Isracard CI activation failure pattern).
 * @param page - Playwright page with attached frames.
 * @param targetUrl - The API URL to fetch.
 * @returns Succeed(page|frame) when an origin match exists, fail otherwise.
 */
function resolveContext(page: Page, targetUrl: string): Procedure<Page | Frame> {
  const targetOrigin = new URL(targetUrl).origin;
  const pageOrigin = new URL(page.url()).origin;
  if (targetOrigin === pageOrigin) return succeed(page);
  const frame = page.frames().find((f): OriginMatch => {
    const frameUrl = f.url();
    if (!frameUrl || frameUrl === 'about:blank') return false;
    return new URL(frameUrl).origin === targetOrigin;
  });
  if (frame) {
    const frameUrl = frame.url().slice(0, 50);
    LOG.trace({
      message: `using iframe context: ${frameUrl}`,
    });
    return succeed(frame);
  }
  const frameOrigins = listFrameOrigins(page);
  return fail(
    ScraperErrorTypes.Generic,
    `no fetch context for origin ${targetOrigin}: page on ${pageOrigin}, frames=[${frameOrigins}]`,
  );
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
    const ctxResult = resolveContext(this._page, url);
    if (!ctxResult.success) return ctxResult;
    const ctx = ctxResult.value;
    return fetchPostWithinPage<T>(ctx, url, { data, extraHeaders: opts.extraHeaders })
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
    const ctxResult = resolveContext(this._page, url);
    if (!ctxResult.success) return ctxResult;
    const ctx = ctxResult.value;
    if (!hasHeaders) {
      return fetchGetWithinPage<T>(ctx, url, false)
        .then((result): Procedure<T> => resultToProcedure(result, url))
        .catch(catchError);
    }
    return fetchGetWithinPageWithHeaders<T>(ctx, url, opts.extraHeaders)
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * Session activation via .ashx proxy — establishes server-side session.
   * Uses config.auth for companyCode/countryCode/idType/checkLevel (generic, not hardcoded).
   * @param credentials - User credentials (id, password, card6Digits).
   * @param config - Bank config with auth params and api.base URL.
   * @param discoveredServicesUrl - Proxy URL from network discovery (overrides config.api.base).
   * @returns Succeed(true) if session activated, fail if auth rejected.
   */
  public async activateSession(
    credentials: ScraperCredentials,
    config: BankConfig,
    discoveredServicesUrl?: string,
  ): Promise<Procedure<SessionActivated>> {
    const servicesUrl =
      discoveredServicesUrl ?? `${config.api?.base ?? ''}/services/ProxyRequestHandler.ashx`;
    if (!servicesUrl || servicesUrl.startsWith('/')) {
      return fail(ScraperErrorTypes.Generic, 'ACTIVATION: no servicesUrl');
    }
    return activateViaProxy({ page: this._page, servicesUrl, credentials, config });
  }

  /**
   * Proxy GET — fetch data via .ashx proxy handler on the api.base domain.
   * Constructs URL: config.api?.base/services/ProxyRequestHandler.ashx?reqName=...&params
   * @param config - Bank config with api.base URL.
   * @param reqName - The proxy request name (discovered from traffic).
   * @param params - Additional query parameters.
   * @returns Procedure with parsed JSON response.
   */
  public async proxyGet<T>(
    config: BankConfig,
    reqName: ProxyReqName,
    params: Record<string, string>,
  ): Promise<Procedure<T>> {
    const baseUrl = config.api?.base;
    if (!baseUrl) return fail(ScraperErrorTypes.Generic, 'proxyGet: no api.base in config');
    const url = new URL(`${baseUrl}/services/ProxyRequestHandler.ashx`);
    url.searchParams.set('reqName', reqName);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }
    const fullUrl = url.toString();
    LOG.debug({
      message: `PROXY GET ${maskVisibleText(fullUrl)}`,
    });
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
  return Reflect.construct(BrowserFetchStrategy, [page]);
}

export default BrowserFetchStrategy;
export { BrowserFetchStrategy, createBrowserFetchStrategy };
