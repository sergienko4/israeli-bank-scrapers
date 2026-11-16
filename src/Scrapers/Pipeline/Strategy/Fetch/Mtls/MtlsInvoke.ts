/**
 * mTLS invoke policy: fallback transport, per-request timeout, response
 * synthesis and PII-safe failure text.
 *
 * <p>Both settings arrive as arguments. The module holds no mutable state, so
 * two concurrent runs cannot overwrite each other's fallback or timeout.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type {
  IMtlsFallbackRequest,
  IMtlsInvokeOptions,
} from '../../../Types/Domain/MtlsInvokeTypes.js';
import { toError } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { FetchInvoke, IFetchInvokePolicy } from '../FetchStrategy.js';
import { isMediaTypeMismatch } from '../MediaTypeCheck.js';
import { isApiSuccess } from '../NativeFetchStrategy.js';
import { safeUrlForLog, scrubUrlFromText } from '../SafeUrlForLog.js';
import type { AgentSource, IPresentedCert } from './MtlsAgentSource.js';
import type { IMtlsRequest } from './MtlsRequest.js';
import { sendRequest } from './MtlsRequest.js';
import { collectBody, toResponse } from './MtlsResponse.js';

/** Production ceiling for one mTLS request (connect + full response). */
const DEFAULT_MTLS_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Wrap a thrown mTLS error into a failure naming origin + path only.
 * @param error - The caught value, from any realm.
 * @param request - The request that failed.
 * @returns Procedure failure with no query string, even one the error quotes.
 */
function toMtlsFailure(error: unknown, request: IMtlsRequest): Procedure<Response> {
  const rawReason = toError(error).message;
  const reason = scrubUrlFromText(rawReason, request.url, request.redactUrlValues);
  const safeUrl = safeUrlForLog(request.url, request.redactUrlValues);
  return fail(ScraperErrorTypes.Generic, `${request.verb} ${safeUrl} mtls error: ${reason}`);
}

/**
 * Build the header-only response used for media-type refusal.
 * @param message - The received status and headers.
 * @returns Response with an empty body.
 */
function emptyResponse(message: Awaited<ReturnType<typeof sendRequest>>): Response {
  const empty = Buffer.alloc(0);
  return toResponse(message, empty);
}

/**
 * Read the buffered body into the final response.
 * @param message - The received status, headers and unread body.
 * @returns Buffered response.
 */
async function readBody(message: Awaited<ReturnType<typeof sendRequest>>): Promise<Response> {
  const body = await collectBody(message);
  return toResponse(message, body);
}

/**
 * Whether the response headers alone refuse the expected media type.
 * @param response - Header-only response.
 * @param mediaType - Expected media type, when one is named.
 * @returns True when the media-type check can decide without the body.
 */
function isHeaderRefusal(response: Response, mediaType?: string): boolean {
  return isApiSuccess(response) && isMediaTypeMismatch(response, mediaType);
}

/**
 * Stop at mismatched API headers; the shared router retains status/WAF precedence.
 * @param message - The received status, headers and unread body.
 * @param mediaType - Expected media type, when one is named.
 * @returns Header-only mismatch response, otherwise the buffered response.
 */
async function readMtlsResponse(
  message: Awaited<ReturnType<typeof sendRequest>>,
  mediaType?: string,
): Promise<Response> {
  const response = emptyResponse(message);
  if (!isHeaderRefusal(response, mediaType)) return readBody(message);
  message.destroy();
  return response;
}

/**
 * Perform an mTLS request and surface a Procedure<Response>.
 * @param request - The fully-specified mTLS request.
 * @param timeoutMs - Per-request timeout.
 * @returns Procedure carrying the synthesised Response, or a network failure.
 */
async function mtlsInvoke(request: IMtlsRequest, timeoutMs: number): Promise<Procedure<Response>> {
  try {
    const message = await sendRequest(request, timeoutMs);
    const response = await readMtlsResponse(message, request.mediaType);
    return succeed(response);
  } catch (error) {
    return toMtlsFailure(error, request);
  }
}

/**
 * Build the request shape an injected fallback receives.
 * @param request - The fully-specified mTLS request.
 * @param presented - The certificate the agent presents.
 * @returns Fallback request without the agent.
 */
function toFallbackRequest(
  request: IMtlsRequest,
  presented: IPresentedCert | false,
): IMtlsFallbackRequest {
  const { url, init, verb, mediaType, redactUrlValues } = request;
  return { url, init, verb, mediaType, redactUrlValues, presented };
}

/**
 * Send one request through an injected fallback.
 * @param request - The fully-specified mTLS request.
 * @param presented - The certificate the agent presents.
 * @param fallback - Injected transport.
 * @returns Procedure carrying the synthesised Response.
 */
function invokeFallback(
  request: IMtlsRequest,
  presented: IPresentedCert | false,
  fallback: NonNullable<IMtlsInvokeOptions['fallback']>,
): Promise<Procedure<Response>> {
  const fallbackRequest = toFallbackRequest(request, presented);
  return fallback(fallbackRequest);
}

/**
 * Send one resolved request through the fallback or the real node:https path.
 * @param request - The request and the agent picked for it.
 * @param presented - The certificate the agent presents.
 * @param options - Per-execution fallback and timeout.
 * @returns Procedure carrying the synthesised Response, or a network failure.
 */
function invokeThrough(
  request: IMtlsRequest,
  presented: IPresentedCert | false,
  options: IMtlsInvokeOptions,
): Promise<Procedure<Response>> {
  if (options.fallback !== undefined) return invokeFallback(request, presented, options.fallback);
  const timeoutMs = options.timeoutMs ?? DEFAULT_MTLS_REQUEST_TIMEOUT_MS;
  return mtlsInvoke(request, timeoutMs);
}

/** The request plus the certificate the picked agent presents. */
interface IInvokeTarget {
  readonly request: IMtlsRequest;
  readonly presented: IPresentedCert | false;
}

/** One invoke call's inputs, bundled under the 3-parameter ceiling. */
interface ITargetArgs {
  readonly source: AgentSource;
  readonly url: string;
  readonly init: RequestInit;
  readonly policy: IFetchInvokePolicy;
}

/**
 * Resolve the agent and build the request it will carry.
 * @param args - Agent source, URL, init and policy.
 * @returns Request plus presented certificate.
 */
function targetFor(args: ITargetArgs): IInvokeTarget {
  const choice = args.source(args.url);
  const request: IMtlsRequest = {
    ...args.policy,
    agent: choice.agent,
    url: args.url,
    init: args.init,
  };
  return { request, presented: choice.presented };
}

/**
 * Bind an agent source into a FetchInvoke transport for a strategy's `_invoke`
 * seam. The source is asked on every request, so a dynamic client certificate
 * installed mid-run applies to the next request.
 * @param source - Picks the mTLS agent for each request URL.
 * @param options - Per-execution fallback and timeout.
 * @returns A FetchInvoke that routes each request through the picked agent.
 */
function makeMtlsInvoke(source: AgentSource, options: IMtlsInvokeOptions = {}): FetchInvoke {
  /**
   * Perform one request through the agent the source picks.
   * @param url - Fully-qualified target URL.
   * @param init - Native fetch RequestInit (method/headers/body).
   * @param policy - HTTP verb and expected response media type.
   * @returns Procedure carrying the synthesised Response, or a network failure.
   */
  const invoke: FetchInvoke = (url, init, policy) => {
    const target = targetFor({ source, url, init, policy });
    return invokeThrough(target.request, target.presented, options);
  };
  return invoke;
}

export default makeMtlsInvoke;
