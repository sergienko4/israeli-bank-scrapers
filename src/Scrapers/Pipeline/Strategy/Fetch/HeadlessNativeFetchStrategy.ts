/**
 * Headless native fetch strategy — the NativeFetchStrategy a bank that opts
 * into `nativeFetch` runs on. It replaces two seams and inherits the rest
 * (response parsing, failure classification, Set-Cookie emission, PII-safe
 * logging):
 *  - the transport caps every request, body included, at
 *    {@link NATIVE_REQUEST_TIMEOUT_MS}, so a hung socket surfaces as a
 *    `Generic` timeout failure instead of stalling the run;
 *  - a GET carries no default JSON content-type, because it has no body.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { NETWORK_FETCH_TIMEOUT_MS } from '../../Mediator/Network/FetchConfig.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { DefaultHeadersByVerb, HttpVerb } from './NativeFetchStrategy.js';
import { NativeFetchStrategy, toNetworkFailure } from './NativeFetchStrategy.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** Ceiling (ms) for one native request, connect through the full body. */
const NATIVE_REQUEST_TIMEOUT_MS = NETWORK_FETCH_TIMEOUT_MS;

/** Active per-request ceiling (ms). Overridable for deterministic tests. */
let requestTimeoutMs: number = NATIVE_REQUEST_TIMEOUT_MS;

/**
 * Override the per-request ceiling (ms). Production keeps the default; the
 * test suite lowers it to prove the timeout path without fake timers.
 * @param ms - New ceiling in milliseconds.
 * @returns The ceiling now in effect.
 */
function setNativeRequestTimeoutMs(ms: number): number {
  requestTimeoutMs = ms;
  return requestTimeoutMs;
}

/** Error names a fetch rejects with once its abort signal fires. */
const ABORT_ERROR_NAMES: readonly unknown[] = ['TimeoutError', 'AbortError'];

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
  return ABORT_ERROR_NAMES.includes(name);
}

/**
 * Map a rejected capped request onto a network-error Procedure.
 * @param error - The caught value.
 * @param verb - HTTP verb (for the error-message prefix).
 * @param url - Target URL (for the error-message prefix).
 * @returns A `Generic` timeout failure, or the inherited network failure.
 */
function toCappedFailure(error: unknown, verb: HttpVerb, url: string): Procedure<Response> {
  if (!isAbortRejection(error)) return toNetworkFailure(error, verb, url);
  const safeUrl = safeUrlForLog(url);
  return fail(ScraperErrorTypes.Generic, `${verb} ${safeUrl} network error: timeout`);
}

/**
 * Fetch under the cap and drain the body before returning. The drain reads
 * a clone, so the inherited parser still reads the original; a body that
 * hangs past the cap rejects here, inside the transport's catch.
 * @param url - Target URL.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @returns The fully-received Response.
 */
async function fetchWithinCap(url: string, init: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  const response = await globalThis.fetch(url, { ...init, signal });
  await response.clone().arrayBuffer();
  return response;
}

/**
 * Capped transport for the `_invoke` seam.
 * @param url - Target URL.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @param verb - HTTP verb (for error-message prefixing).
 * @returns Procedure carrying the Response, or a network/timeout failure.
 */
async function invokeCapped(
  url: string,
  init: RequestInit,
  verb: HttpVerb,
): Promise<Procedure<Response>> {
  try {
    const response = await fetchWithinCap(url, init);
    return succeed(response);
  } catch (error) {
    return toCappedFailure(error, verb, url);
  }
}

/** Native fetch with a per-request cap and body-less GET defaults. */
class HeadlessNativeFetchStrategy extends NativeFetchStrategy {
  /**
   * Bind the strategy to a base URL and install the capped seams.
   * @param baseUrl - Base URL for API requests.
   */
  constructor(baseUrl: string) {
    super(baseUrl);
    this._invoke = invokeCapped;
    this._verbDefaults = HEADLESS_DEFAULT_HEADERS;
  }
}

export default HeadlessNativeFetchStrategy;
export { HeadlessNativeFetchStrategy, NATIVE_REQUEST_TIMEOUT_MS, setNativeRequestTimeoutMs };
