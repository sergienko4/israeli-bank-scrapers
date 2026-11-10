/**
 * Capped invoke — the request seam a capped native transport installs. It
 * bounds every attempt (connect through the required body), repeats a
 * single-hop request while it times out connecting, and turns a rejection
 * into a network failure. A timeout abort is reported as `Timeout`; anything
 * else keeps the inherited network classification.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { NETWORK_CONNECT_RETRIES } from '../../Mediator/Network/FetchConfig.js';
import type { IResponseReading } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { ICappedRequest } from './CappedBody.js';
import { fetchWithinCap } from './CappedBody.js';
import { retryOnConnectTimeout } from './ConnectRetry.js';
import type { FetchInvoke, IFetchInvokePolicy } from './FetchStrategy.js';
import { toNetworkFailure } from './NativeFetchNetwork.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** Error names a fetch rejects with once its abort signal fires. */
const ABORT_ERROR_NAMES: ReadonlySet<unknown> = new Set(['TimeoutError', 'AbortError']);

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

/** Args of a rejected capped request: the error plus what the message needs. */
interface ICappedFailureArgs {
  readonly error: unknown;
  readonly url: string;
  readonly policy: IFetchInvokePolicy;
  readonly reading: IResponseReading;
}

/**
 * Map a rejected capped request onto a network-error Procedure.
 * @param args - The caught error plus the request it was made for.
 * @returns A `Timeout` failure, or the inherited network failure.
 */
function toCappedFailure(args: ICappedFailureArgs): Procedure<Response> {
  const { error, url, policy, reading } = args;
  const redactUrlValues = policy.redactUrlValues ?? reading.redactUrlValues;
  const request = { url, verb: policy.verb, redactUrlValues };
  if (!isAbortRejection(error)) return toNetworkFailure(error, request);
  const safeUrl = safeUrlForLog(url, redactUrlValues);
  return fail(ScraperErrorTypes.Timeout, `${policy.verb} ${safeUrl} network error: timeout`);
}

/**
 * Connect retries one request may take. Only a single-hop request
 * (`redirect: 'manual'`) is repeated: under `follow` fetch walks redirects
 * itself, so a connect timeout may come from a later hop after the original
 * request was already processed, and replaying it would resend its body.
 * @param request - The request's wire options and retry policy.
 * @returns The repeat budget, zero when fetch follows redirects itself.
 */
function connectRetriesFor(request: ICappedRequest): number {
  if (request.isConnectRetryDisabled) return 0;
  return request.init.redirect === 'manual' ? NETWORK_CONNECT_RETRIES : 0;
}

/**
 * Start one capped request with its own fresh timeout signal.
 * @param request - Request, reading policy and per-attempt timeout ceiling.
 * @returns The received Response.
 */
async function attempt(request: ICappedRequest): Promise<Procedure<Response>> {
  return fetchWithinCap(request);
}

/**
 * Cap a request and repeat a single-hop one on a fresh connection while it times out connecting.
 * Each attempt gets its own `timeoutMs`, so the cap bounds one attempt, not the sum.
 * @param request - Request, reading policy and per-attempt timeout ceiling.
 * @returns The received Response from the first attempt that connected.
 */
async function fetchRetryingConnect(request: ICappedRequest): Promise<Procedure<Response>> {
  const retries = connectRetriesFor(request);
  return retryOnConnectTimeout((): Promise<Procedure<Response>> => attempt(request), retries);
}

/**
 * Execute a capped request and convert a transport rejection to a failure.
 * @param request - Request and reading policy.
 * @param policy - Request verb and redaction policy.
 * @returns Response, integrity refusal, or network failure.
 */
async function invokeCapped(
  request: ICappedRequest,
  policy: IFetchInvokePolicy,
): Promise<Procedure<Response>> {
  try {
    return await fetchRetryingConnect(request);
  } catch (error) {
    return toCappedFailure({ error, url: request.url, policy, reading: request.reading });
  }
}

/**
 * Build the capped transport for the `_invoke` seam.
 * @param timeoutMs - Ceiling (ms) for each request.
 * @param reading - The call's immutable reading policy.
 * @param isConnectRetryDisabled - Whether to forbid connect-timeout retries.
 * @returns A transport yielding the Response, or a network/timeout failure.
 */
function makeInvokeCapped(
  timeoutMs: number,
  reading: IResponseReading,
  isConnectRetryDisabled: boolean,
): FetchInvoke {
  return async (url, init, policy): Promise<Procedure<Response>> =>
    invokeCapped({ url, init, timeoutMs, reading, isConnectRetryDisabled }, policy);
}

export default makeInvokeCapped;
