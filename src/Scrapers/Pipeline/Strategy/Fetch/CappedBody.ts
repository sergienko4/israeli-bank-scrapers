/**
 * Capped response reading — decides how much of an answer one request may
 * consume before it is handed to the shared dispatcher. A header-only outcome
 * (redirect, status decision, media-type refusal, Cloudflare challenge) is
 * released without buffering its body, while a body the reader needs is read
 * under the request's timeout and optional response-integrity policy.
 */

import type { IResponseIntegrity, IResponseReading } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import { isMediaTypeMismatch } from './MediaTypeCheck.js';
import { isApiSuccess } from './NativeFetchDispatch.js';
import { isRedirectStatus } from './RedirectShared.js';
import { verifyResponseIntegrity } from './ResponseIntegrityReader.js';
import { statusActionFor } from './StatusPolicy.js';

/** Request-local cap and reading policy; concurrent calls never share mutable state. */
interface ICappedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMs: number;
  readonly reading: IResponseReading;
  readonly isConnectRetryDisabled: boolean;
}

/**
 * Whether a response carries the Cloudflare challenge marker.
 * @param response - Received response.
 * @returns True when the edge marked it as a challenge.
 */
function isChallenge(response: Response): boolean {
  const headers = Object.fromEntries(response.headers);
  return hasCloudflareChallengeHeader(headers);
}

/**
 * Whether an integrity-bounded answer is a header-only challenge.
 * @param response - Received response.
 * @param reading - Response-reading policy.
 * @returns True when the challenge body is not needed.
 */
function isBoundedChallenge(response: Response, reading: IResponseReading): boolean {
  return reading.responseIntegrity !== undefined && isChallenge(response);
}

/**
 * Whether a manual 3xx body can be released unread: no policy keeps it.
 * @param response - Received headers and status.
 * @param request - This call's wire redirect mode and response-reading policy.
 * @returns True when the body is not needed.
 */
function releasesRedirectBody(response: Response, request: ICappedRequest): boolean {
  if (request.init.redirect !== 'manual' || !isRedirectStatus(response.status)) return false;
  return request.reading.keepRedirectBody !== true;
}

/**
 * Whether a non-challenge answer or an unbounded challenge needs its body.
 * @param response - Received response.
 * @param reading - Response-reading policy.
 * @param action - The effective status action.
 * @returns True when the WAF classifier or reader needs the body.
 */
function needsBodyAfterChallenge(
  response: Response,
  reading: IResponseReading,
  action: ReturnType<typeof statusActionFor>,
): boolean {
  if (isChallenge(response)) return true;
  if (action.has) return false;
  if (!isApiSuccess(response)) return true;
  return !isMediaTypeMismatch(response, reading.mediaType);
}

/**
 * Whether the WAF classifier or response reader still needs the body.
 * @param response - Received headers and status.
 * @param request - This call's wire redirect mode and response-reading policy.
 * @returns False for status decisions or media-type refusals from headers.
 */
function needsBody(response: Response, request: ICappedRequest): boolean {
  const { reading } = request;
  if (releasesRedirectBody(response, request)) return false;
  if (isBoundedChallenge(response, reading)) return false;
  const action = statusActionFor({ response, reading });
  if (action.has && action.value === 'rate-limit') return false;
  return needsBodyAfterChallenge(response, reading, action);
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
 * The integrity policy a response is checked against: the full policy for an
 * answer body (2xx, or a 3xx kept by `accept`), byte cap only for a failure.
 * @param response - Response whose headers have passed policy checks.
 * @param reading - The call's immutable reading policy.
 * @param policy - The validated byte and digest policy.
 * @returns The policy to apply.
 */
function appliedIntegrity(
  response: Response,
  reading: IResponseReading,
  policy: IResponseIntegrity,
): IResponseIntegrity {
  if (isApiSuccess(response)) return policy;
  const isKept = reading.keepRedirectBody === true && isRedirectStatus(response.status);
  return isKept ? policy : { maxBytes: policy.maxBytes };
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
  const checked = await verifyResponseIntegrity(response, policy, controller);
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
  const applied = appliedIntegrity(response, reading, policy);
  return checkBoundedBody(response, controller, applied);
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

export type { ICappedRequest };
export { fetchWithinCap };
