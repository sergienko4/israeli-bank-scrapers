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
 * Its status policy, media type defaults and strict UTF-8 choice
 * are installed the same way.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  NETWORK_CONNECT_RETRIES,
  NETWORK_FETCH_TIMEOUT_MS,
} from '../../Mediator/Network/FetchConfig.js';
import type { IResponseIntegrity, IResponseReading } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { retryOnConnectTimeout } from './ConnectRetry.js';
import type { IFetchInvokePolicy, IFetchOpts } from './FetchStrategy.js';
import { hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import { isMediaTypeMismatch } from './MediaTypeCheck.js';
import type {
  DefaultHeadersByVerb,
  FetchInvoke,
  IDispatch,
  INativeFetchOptions,
  TRequest,
} from './NativeFetchStrategy.js';
import { isApiSuccess, NativeFetchStrategy, toNetworkFailure } from './NativeFetchStrategy.js';
import { isRedirectStatus } from './RedirectFollow.js';
import { verifyResponseIntegrity } from './ResponseIntegrityReader.js';
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
  readonly isConnectRetryDisabled: boolean;
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
 * Args of a rejected capped request: the error plus what the message needs.
 */
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
 * Whether an integrity-bounded answer is a header-only challenge.
 * @param response - Received response.
 * @param reading - Response-reading policy.
 * @returns True when the challenge body is not needed.
 */
function isBoundedChallenge(response: Response, reading: IResponseReading): boolean {
  if (reading.responseIntegrity === undefined) return false;
  const headers = Object.fromEntries(response.headers);
  return hasCloudflareChallengeHeader(headers);
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
  if (isBoundedChallenge(response, reading)) return false;
  const action = statusActionFor({ response, reading });
  if (!isApiSuccess(response)) return !(action.has && action.value === 'rate-limit');
  if (action.has) return false;
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
 * Buffers a response under the existing timeout when no byte policy is named.
 * @param response - Response whose headers have passed policy checks.
 * @returns The buffered response.
 */
async function readUnbounded(response: Response): Promise<Procedure<Response>> {
  await response.clone().arrayBuffer();
  return succeed(response);
}

/**
 * Verifies successful bytes and bounds failures for their normal classification.
 * @param response - Response whose headers have passed policy checks.
 * @param controller - Request-local abort controller.
 * @param policy - The validated byte and digest policy.
 * @returns The buffered response or a fixed integrity refusal.
 */
async function checkBoundedBody(
  response: Response,
  controller: AbortController,
  policy: IResponseIntegrity,
): Promise<Procedure<Response>> {
  const applied = isApiSuccess(response) ? policy : { maxBytes: policy.maxBytes };
  const checked = await verifyResponseIntegrity(response, applied, controller);
  return isOk(checked) ? succeed(response) : checked;
}

/**
 * Buffers a required response under its optional integrity policy.
 * @param response - Response whose headers have passed policy checks.
 * @param controller - Request-local abort controller.
 * @param reading - The call's immutable reading policy.
 * @returns The buffered response or a fixed integrity refusal.
 */
async function readWithinCap(
  response: Response,
  controller: AbortController,
  reading: IResponseReading,
): Promise<Procedure<Response>> {
  const policy = reading.responseIntegrity;
  if (policy === undefined) return readUnbounded(response);
  return checkBoundedBody(response, controller, policy);
}

/**
 * Cap connect and required-body reads; leave header-only outcomes unbuffered.
 * The clone preserves the original body for the inherited response reader.
 * @param request - Request, reading policy and timeout ceiling.
 * @returns The received Response or a response-integrity refusal.
 */
async function fetchWithinCap(request: ICappedRequest): Promise<Procedure<Response>> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(request.timeoutMs)]);
  const response = await globalThis.fetch(request.url, { ...request.init, signal });
  if (needsBody(response, request)) return readWithinCap(response, controller, request.reading);
  const stopped = stopAfterHeaders(response, controller);
  return succeed(stopped);
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
 * Cap a request and repeat a single-hop one on a fresh connection while it times out connecting.
 * Each attempt gets its own `timeoutMs`, so the cap bounds one attempt, not the sum.
 * @param request - Request, reading policy and per-attempt timeout ceiling.
 * @returns The received Response from the first attempt that connected.
 */
async function fetchRetryingConnect(request: ICappedRequest): Promise<Procedure<Response>> {
  /**
   * Start one capped request with its own fresh timeout signal.
   * @returns The received Response.
   */
  const attempt = async (): Promise<Procedure<Response>> => fetchWithinCap(request);
  const retries = connectRetriesFor(request);
  return retryOnConnectTimeout(attempt, retries);
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
    this._supportsResponseIntegrity = true;
  }

  /**
   * Bind the body cap to this call's reading policy, including every redirect hop.
   * @param request - Request built by the verb method.
   * @param opts - Per-call policy and hooks.
   * @returns The dispatched run with its request-local capped transport.
   */
  protected toRun(request: TRequest, opts: IFetchOpts): IDispatch {
    const run = super.toRun(request, opts);
    const invoke = makeInvokeCapped(this._timeoutMs, run.reading, this._isConnectRetryDisabled);
    return { ...run, invoke };
  }
}

export default HeadlessNativeFetchStrategy;
export type { IHeadlessNativeFetchOptions };
export { HeadlessNativeFetchStrategy, makeInvokeCapped };
