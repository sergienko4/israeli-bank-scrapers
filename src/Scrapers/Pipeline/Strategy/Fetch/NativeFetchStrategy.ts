/**
 * Native fetch strategy — uses globalThis.fetch for API-only scrapers (no browser).
 * Caller-supplied extraHeaders WIN on collision with the default content-type.
 * Every async path returns Procedure<T>; no thrown errors escape the class.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Brand, SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy, PostData } from './FetchStrategy.js';

type SetCookieEmitCount = Brand<number, 'SetCookieEmitCount'>;
type FullyQualifiedUrl = Brand<string, 'FullyQualifiedUrl'>;

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Maximum length of a response-body snippet embedded in an error message. */
const ERROR_BODY_SNIPPET_LEN = 120;

/**
 * Strip query string and credentials from a URL for safe logging.
 * Per `logging-pii-guidlines.txt`, never log query parameters that may
 * carry session ids, tokens, or PII (uid, phoneNumber, etc.). Returns
 * `<scheme>//<host><path>` only — enough for traceability without
 * leaking sensitive fields.
 * @param url - Full URL to sanitize.
 * @returns Origin + path only as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    return mintSafeUrlForLog(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return mintSafeUrlForLog('<unparseable>');
  }
}

/** HTTP method verbs used by this strategy. */
type HttpVerb = 'GET' | 'POST';

/**
 * Merge the default JSON content-type with caller-supplied headers.
 * Caller wins on collision (e.g., text/plain overrides application/json).
 * @param extraHeaders - Caller-supplied headers (may override defaults).
 * @returns Merged headers record ready for fetch.
 */
function mergeHeaders(extraHeaders: Record<string, string>): Record<string, string> {
  const defaults: Record<string, string> = { 'content-type': 'application/json' };
  return { ...defaults, ...extraHeaders };
}

/**
 * Parse a Response body as JSON, with a structured failure on malformed input.
 * @param response - The fetch Response to parse.
 * @param verb - HTTP verb (for the error-message prefix).
 * @param url - Target URL (for the error-message prefix).
 * @returns Procedure carrying the parsed body, or a parse-error failure.
 */
async function parseJsonResponse<T>(
  response: Response,
  verb: HttpVerb,
  url: string,
): Promise<Procedure<T>> {
  const rawText = await response.text();
  try {
    const parsed = JSON.parse(rawText) as T;
    return succeed(parsed);
  } catch (error) {
    const reason = toErrorMessage(error);
    return fail(ScraperErrorTypes.Generic, `${verb} ${url} parse error: ${reason}`);
  }
}

/**
 * Classify a non-2xx Response into a Procedure failure with status + body snippet.
 * @param response - The fetch Response with a non-2xx status.
 * @param verb - HTTP verb (for the error-message prefix).
 * @param url - Target URL (for the error-message prefix).
 * @returns A Generic failure Procedure annotated with status + body snippet.
 */
async function classifyStatus<T>(
  response: Response,
  verb: HttpVerb,
  url: string,
): Promise<Procedure<T>> {
  const rawText = await response.text();
  const snippet = rawText.slice(0, ERROR_BODY_SNIPPET_LEN);
  const message = `${verb} ${url} ${String(response.status)}: ${snippet}`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Route a Response through parse vs classify based on ok-ness.
 * @param response - The fetch Response returned by globalThis.fetch.
 * @param verb - HTTP verb (for error-message prefixing).
 * @param url - Target URL (for error-message prefixing).
 * @returns Procedure with parsed body or classified failure.
 */
function routeResponse<T>(response: Response, verb: HttpVerb, url: string): Promise<Procedure<T>> {
  if (response.ok) return parseJsonResponse<T>(response, verb, url);
  return classifyStatus<T>(response, verb, url);
}

/**
 * Invoke onSetCookie hook when present, passing raw Set-Cookie lines.
 * Uses Headers.getSetCookie() (Node 18+) to preserve multi-value arrays.
 * @param response - Raw fetch Response.
 * @param hook - Optional caller-supplied callback.
 * @returns Number of Set-Cookie lines emitted (0 when no hook / no cookies).
 */
function emitSetCookies(response: Response, hook?: IFetchOpts['onSetCookie']): SetCookieEmitCount {
  if (!hook) return 0 as SetCookieEmitCount;
  const list = response.headers.getSetCookie();
  if (list.length === 0) return 0 as SetCookieEmitCount;
  hook(list);
  return list.length as SetCookieEmitCount;
}

/**
 * Wrap a thrown fetch error into a network-error Procedure.
 * @param error - The caught value (Error or string).
 * @param verb - HTTP verb (for error-message prefixing).
 * @param url - Target URL (for error-message prefixing).
 * @returns Procedure failure annotated with the underlying reason.
 */
function toNetworkFailure(error: Error | string, verb: HttpVerb, url: string): Procedure<Response> {
  const reason = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, `${verb} ${url} network error: ${reason}`);
}

/**
 * Run globalThis.fetch and surface the Response or a network-error Procedure.
 * @param url - Target URL.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @param verb - HTTP verb (for error-message prefixing).
 * @returns Procedure carrying the raw Response, or a network-error failure.
 */
async function invokeFetch(
  url: string,
  init: RequestInit,
  verb: HttpVerb,
): Promise<Procedure<Response>> {
  try {
    const response = await globalThis.fetch(url, init);
    return succeed(response);
  } catch (error) {
    return toNetworkFailure(error as Error, verb, url);
  }
}

/** Args bundle for dispatchFetch — keeps params under the 3-ceiling. */
interface IDispatchArgs {
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: HttpVerb;
  readonly onSetCookie?: IFetchOpts['onSetCookie'];
}

/**
 * Dispatch a fetch call and route success/non-2xx through the helpers.
 * Emits PII-safe DEBUG traces at fire and after-status. Per
 * `logging-pii-guidlines.txt`, the URL is stripped of query string
 * (which may carry session ids / tokens) before logging.
 * @param args - url + init + verb + optional cookie hook.
 * @returns Procedure with parsed body or structured failure.
 */
async function dispatchFetch<T>(args: IDispatchArgs): Promise<Procedure<T>> {
  const safeUrl = safeUrlForLog(args.url);
  LOG.debug({ verb: args.verb, url: safeUrl, message: '[fetch] FIRE' });
  const fetchResult = await invokeFetch(args.url, args.init, args.verb);
  if (!fetchResult.success) {
    LOG.debug({
      verb: args.verb,
      url: safeUrl,
      errorMessage: fetchResult.errorMessage,
      message: '[fetch] NETWORK FAIL',
    });
    return fetchResult;
  }
  const status = fetchResult.value.status;
  LOG.debug({ verb: args.verb, url: safeUrl, status, message: '[fetch] STATUS' });
  emitSetCookies(fetchResult.value, args.onSetCookie);
  return routeResponse<T>(fetchResult.value, args.verb, args.url);
}

/** Native fetch — uses globalThis.fetch with merged JSON headers. */
class NativeFetchStrategy implements IFetchStrategy {
  protected readonly _baseUrl: string;

  /**
   * Create a NativeFetchStrategy.
   * @param baseUrl - The base URL for API requests.
   */
  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  /**
   * POST a JSON body via globalThis.fetch.
   * @param url - Target URL (absolute, or relative to baseUrl).
   * @param data - POST body, serialised as JSON.
   * @param opts - Fetch options (caller extraHeaders override defaults).
   * @returns Procedure with parsed response or structured failure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const fullUrl = this.resolveUrl(url);
    const headers = mergeHeaders(opts.extraHeaders);
    const body = JSON.stringify(data);
    const init: RequestInit = { method: 'POST', headers, body };
    return dispatchFetch<T>({ url: fullUrl, init, verb: 'POST', onSetCookie: opts.onSetCookie });
  }

  /**
   * GET via globalThis.fetch.
   * @param url - Target URL (absolute, or relative to baseUrl).
   * @param opts - Fetch options (caller extraHeaders override defaults).
   * @returns Procedure with parsed response or structured failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const fullUrl = this.resolveUrl(url);
    const headers = mergeHeaders(opts.extraHeaders);
    const init: RequestInit = { method: 'GET', headers };
    return dispatchFetch<T>({ url: fullUrl, init, verb: 'GET', onSetCookie: opts.onSetCookie });
  }

  /**
   * Resolve a URL against the instance baseUrl (absolute URLs pass through).
   * @param url - Caller-supplied URL (absolute or relative).
   * @returns The fully-qualified URL suitable for globalThis.fetch.
   */
  protected resolveUrl(url: string): FullyQualifiedUrl {
    if (url.startsWith('http://') || url.startsWith('https://')) return url as FullyQualifiedUrl;
    return `${this._baseUrl}${url}` as FullyQualifiedUrl;
  }
}

export default NativeFetchStrategy;
export { NativeFetchStrategy };
