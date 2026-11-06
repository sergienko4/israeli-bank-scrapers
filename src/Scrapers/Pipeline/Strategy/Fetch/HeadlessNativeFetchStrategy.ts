/**
 * Headless native fetch strategy — the NativeFetchStrategy a bank that opts
 * into `nativeFetch` runs on. It replaces two seams and inherits the rest
 * (response parsing, failure classification, Set-Cookie emission, PII-safe
 * logging):
 *  - the transport caps every request, any required body included, at the constructor's
 *    `timeoutMs` (default {@link NETWORK_FETCH_TIMEOUT_MS}), so a hung socket
 *    surfaces as a `Timeout` failure instead of stalling the run;
 *  - a GET carries no default JSON content-type, because it has no body.
 * A bank may also set the default redirect policy a call runs under when it
 * names none; every manual redirect hop goes through the same capped seam.
 * Its status policy, media type defaults (N61) and strict UTF-8 choice (N63)
 * are installed the same way.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { NETWORK_FETCH_TIMEOUT_MS } from '../../Mediator/Network/FetchConfig.js';
import type { IResponseReading } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IFetchOpts } from './FetchStrategy.js';
import { isMediaTypeMismatch } from './MediaTypeCheck.js';
import type {
  DefaultHeadersByVerb,
  FetchInvoke,
  HttpVerb,
  IDispatch,
  INativeFetchOptions,
  TRequest,
} from './NativeFetchStrategy.js';
import { isApiSuccess, NativeFetchStrategy, toNetworkFailure } from './NativeFetchStrategy.js';
import { isRedirectStatus } from './RedirectFollow.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import { statusActionFor } from './StatusPolicy.js';

/** Construction options for the capped native transport. */
interface IHeadlessNativeFetchOptions extends INativeFetchOptions {
  /** Ceiling (ms) for one request, connect through the full body. */
  readonly timeoutMs?: number;
}

/** Request-local cap and reading policy; concurrent calls never share mutable state. */
interface ICappedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMs: number;
  readonly reading: IResponseReading;
}

/** Error names a fetch rejects with once its abort signal fires. */
const ABORT_ERROR_NAMES: ReadonlySet<unknown> = new Set(['TimeoutError', 'AbortError']);

/** Default headers per verb: JSON content-type on POST only. */
const HEADLESS_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: {},
  POST: { 'content-type': 'application/json' },
};

/**
 * Whether a rejection came from an aborted signal. Reads `name` instead of
 * using `instanceof DOMException`, which fails across realms.
 * @param error - The caught value.
 * @returns True for a `TimeoutError` / `AbortError`.
 */
function isAbortRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name: unknown = Reflect.get(error, 'name');
  return ABORT_ERROR_NAMES.has(name);
}

/**
 * Map a rejected capped request onto a network-error Procedure.
 * @param error - The caught value.
 * @param verb - HTTP verb (for the error-message prefix).
 * @param url - Target URL (for the error-message prefix).
 * @returns A `Timeout` failure, or the inherited network failure.
 */
function toCappedFailure(error: unknown, verb: HttpVerb, url: string): Procedure<Response> {
  if (!isAbortRejection(error)) return toNetworkFailure(error, verb, url);
  const safeUrl = safeUrlForLog(url);
  return fail(ScraperErrorTypes.Timeout, `${verb} ${safeUrl} network error: timeout`);
}

/**
 * Whether the WAF classifier or response reader still needs the body.
 * @param response - Received headers and status.
 * @param request - This call's wire redirect mode and response-reading policy.
 * @returns False for redirects, status decisions or media-type refusals from headers.
 */
function needsBody(response: Response, request: ICappedRequest): boolean {
  const { init, reading } = request;
  if (init.redirect === 'manual' && isRedirectStatus(response.status)) return false;
  if (!isApiSuccess(response)) return true;
  if (statusActionFor({ response, reading }).has) return false;
  return !isMediaTypeMismatch(response, reading.mediaType);
}

/**
 * Release an unread body without delaying a header-only policy decision.
 * Aborting fetch also stops response-body consumption:
 * https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort
 * @param response - Response whose headers remain available to policy and hooks.
 * @param controller - Controller for this request only.
 * @returns The response, without consuming its body.
 */
function stopAfterHeaders(response: Response, controller: AbortController): Response {
  controller.abort();
  return response;
}

/**
 * Cap connect and required-body reads; leave header-only outcomes unbuffered.
 * The clone preserves the original body for the inherited response reader.
 * @param request - Request, reading policy and timeout ceiling.
 * @returns The received Response, with a complete body only when needed.
 */
async function fetchWithinCap(request: ICappedRequest): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(request.timeoutMs)]);
  const response = await globalThis.fetch(request.url, { ...request.init, signal });
  if (!needsBody(response, request)) return stopAfterHeaders(response, controller);
  await response.clone().arrayBuffer();
  return response;
}

/**
 * Build the capped transport for the `_invoke` seam.
 * @param timeoutMs - Ceiling (ms) for each request.
 * @param reading - The call's immutable reading policy.
 * @returns A transport yielding the Response, or a network/timeout failure.
 */
function makeInvokeCapped(timeoutMs: number, reading: IResponseReading): FetchInvoke {
  return async (url, init, policy): Promise<Procedure<Response>> => {
    try {
      const response = await fetchWithinCap({ url, init, timeoutMs, reading });
      return succeed(response);
    } catch (error) {
      return toCappedFailure(error, policy.verb, url);
    }
  };
}

/** Native fetch with a per-request cap and body-less GET defaults. */
class HeadlessNativeFetchStrategy extends NativeFetchStrategy {
  private readonly _timeoutMs: number;

  /**
   * Bind the strategy to a base URL and install the capped seams.
   * @param baseUrl - Base URL for API requests.
   * @param options - Optional `timeoutMs` ceiling (defaults to the shared
   *   {@link NETWORK_FETCH_TIMEOUT_MS}), default `redirectPolicy` and the
   *   bank's `statusPolicy`, media-type defaults, strict UTF-8 choice and
   *   HTTP-failure body omission.
   */
  constructor(baseUrl: string, options: IHeadlessNativeFetchOptions = {}) {
    super(baseUrl, options);
    this._timeoutMs = options.timeoutMs ?? NETWORK_FETCH_TIMEOUT_MS;
    this._verbDefaults = HEADLESS_DEFAULT_HEADERS;
  }

  /**
   * Bind the body cap to this call's reading policy, including every redirect hop.
   * @param request - Request built by the verb method.
   * @param opts - Per-call policy and hooks.
   * @returns The dispatched run with its request-local capped transport.
   */
  protected toRun(request: TRequest, opts: IFetchOpts): IDispatch {
    const run = super.toRun(request, opts);
    const invoke = makeInvokeCapped(this._timeoutMs, run.reading);
    return { ...run, invoke };
  }
}

export default HeadlessNativeFetchStrategy;
export type { IHeadlessNativeFetchOptions };
export { HeadlessNativeFetchStrategy };
