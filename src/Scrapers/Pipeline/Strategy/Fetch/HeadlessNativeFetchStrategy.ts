/**
 * Headless native fetch strategy — the NativeFetchStrategy a bank that opts
 * into `nativeFetch` runs on. It replaces two seams and inherits the rest
 * (response parsing, failure classification, Set-Cookie emission, PII-safe
 * logging):
 *  - the transport caps every request, body included, at the constructor's
 *    `timeoutMs` (default {@link NETWORK_FETCH_TIMEOUT_MS}), so a hung socket
 *    surfaces as a `Timeout` failure instead of stalling the run;
 *  - a GET carries no default JSON content-type, because it has no body.
 * A bank may also set the default redirect policy a call runs under when it
 * names none; every manual redirect hop goes through the same capped seam.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { NETWORK_FETCH_TIMEOUT_MS } from '../../Mediator/Network/FetchConfig.js';
import type { RedirectPolicy } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { DefaultHeadersByVerb, FetchInvoke, HttpVerb } from './NativeFetchStrategy.js';
import { NativeFetchStrategy, toNetworkFailure } from './NativeFetchStrategy.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** Construction options for the capped native transport. */
interface IHeadlessNativeFetchOptions {
  /** Ceiling (ms) for one request, connect through the full body. */
  readonly timeoutMs?: number;
  /** Redirect policy for calls that name none; `follow` when absent. */
  readonly redirectPolicy?: RedirectPolicy;
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
 * Fetch under the cap and drain the body before returning. The drain reads
 * a clone, so the inherited parser still reads the original; a body that
 * hangs past the cap rejects here, inside the transport's catch.
 * @param url - Target URL.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @param timeoutMs - Ceiling (ms) for the whole request.
 * @returns The fully-received Response.
 */
async function fetchWithinCap(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await globalThis.fetch(url, { ...init, signal });
  await response.clone().arrayBuffer();
  return response;
}

/**
 * Build the capped transport for the `_invoke` seam.
 * @param timeoutMs - Ceiling (ms) for each request.
 * @returns A transport yielding the Response, or a network/timeout failure.
 */
function makeInvokeCapped(timeoutMs: number): FetchInvoke {
  return async (url, init, verb): Promise<Procedure<Response>> => {
    try {
      const response = await fetchWithinCap(url, init, timeoutMs);
      return succeed(response);
    } catch (error) {
      return toCappedFailure(error, verb, url);
    }
  };
}

/** Native fetch with a per-request cap and body-less GET defaults. */
class HeadlessNativeFetchStrategy extends NativeFetchStrategy {
  /**
   * Bind the strategy to a base URL and install the capped seams.
   * @param baseUrl - Base URL for API requests.
   * @param options - Optional `timeoutMs` ceiling (defaults to the shared
   *   {@link NETWORK_FETCH_TIMEOUT_MS}) and default `redirectPolicy`.
   */
  constructor(baseUrl: string, options: IHeadlessNativeFetchOptions = {}) {
    super(baseUrl);
    const timeoutMs = options.timeoutMs ?? NETWORK_FETCH_TIMEOUT_MS;
    this._invoke = makeInvokeCapped(timeoutMs);
    this._verbDefaults = HEADLESS_DEFAULT_HEADERS;
    this._redirectDefault = options.redirectPolicy ?? this._redirectDefault;
  }
}

export default HeadlessNativeFetchStrategy;
export type { IHeadlessNativeFetchOptions };
export { HeadlessNativeFetchStrategy };
