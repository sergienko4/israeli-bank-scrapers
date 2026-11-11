/**
 * Verifies fetch response bytes against the call's integrity policy while
 * retaining the original response.
 *
 * The read itself lives in ResponseIntegrityStream.ts; this module owns the
 * verdict around it — the empty-body digest, the cleanup that aborts a failed
 * response, and the abort classification preserved on success.
 */

import { createHash } from 'node:crypto';

import { getDebug } from '../../Logging/Debug.js';
import type { IResponseIntegrity } from '../../Types/Domain/FetchPolicy.js';
import { RESPONSE_DIGEST_MISMATCH_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { failResponseIntegrity } from './ResponseIntegrityCheck.js';
import { consume, integrityStateOf } from './ResponseIntegrityStream.js';

const LOG = getDebug(import.meta.url);

/** The response, its cloned reader and the request's abort controller. */
interface IVerification {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly controller: AbortController;
}

/**
 * Reports cancellation failures without logging the rejected value.
 * @returns True once the warning is emitted.
 */
function warnCancellationFailure(): boolean {
  LOG.warn({ message: 'Response integrity body cancellation failed' });
  return true;
}

/**
 * Aborts the fetch and requests cancellation of both cloned-body branches.
 * @param response - Original response.
 * @param reader - Reader of the cloned branch.
 * @param controller - Request-local abort controller.
 * @returns True once cleanup has been requested.
 */
function stop(
  response: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
): boolean {
  controller.abort();
  reader.cancel().catch(warnCancellationFailure);
  response.body?.cancel().catch(warnCancellationFailure);
  return true;
}

/**
 * Checks the digest of an empty response.
 * @param policy - Validated response-integrity policy.
 * @returns The empty-body integrity verdict.
 */
function verifyEmpty(policy: IResponseIntegrity): Procedure<void> {
  const digest = createHash('sha256').digest('hex');
  if (policy.sha256 !== undefined && digest !== policy.sha256) {
    return failResponseIntegrity(RESPONSE_DIGEST_MISMATCH_REASON);
  }
  return succeed(undefined);
}

/**
 * Aborts an empty response when its expected digest differs.
 * @param policy - Validated response policy.
 * @param controller - Request-local abort controller.
 * @returns The empty-body integrity verdict.
 */
function verifyEmptyResponse(
  policy: IResponseIntegrity,
  controller: AbortController,
): Procedure<void> {
  const result = verifyEmpty(policy);
  if (!isOk(result)) controller.abort();
  return result;
}

/**
 * Stops rejected response streams before returning the refusal.
 * @param request - Reader and response being checked.
 * @param result - Completed integrity verdict.
 * @returns The verdict after requesting cleanup.
 */
function finishRead(request: IVerification, result: Procedure<void>): Procedure<void> {
  if (!isOk(result)) stop(request.response, request.reader, request.controller);
  return result;
}

/**
 * Stops a failed stream before propagating its network error.
 * @param request - Reader and response being checked.
 * @param error - Rejected stream read.
 * @returns Never; the caller classifies the original error.
 */
function failRead(request: IVerification, error: unknown): never {
  stop(request.response, request.reader, request.controller);
  throw error;
}

/**
 * Release the reader lock once a verification read settles.
 * @param request - Reader and response being checked.
 * @param reading - The in-flight integrity read.
 * @returns The verdict, after cleanup.
 */
function withCleanup(
  request: IVerification,
  reading: Promise<Procedure<void>>,
): Promise<Procedure<void>> {
  const finished = reading.then(result => finishRead(request, result));
  const classified = finished.catch((error: unknown) => failRead(request, error));
  return classified.finally(() => {
    request.reader.releaseLock();
  });
}

/**
 * Verify a response that carries no readable body.
 * @param policy - Validated response-integrity policy.
 * @param controller - Request-local abort controller.
 * @returns The empty-body verdict as a settled promise.
 */
function verifyEmptyRead(
  policy: IResponseIntegrity,
  controller: AbortController,
): Promise<Procedure<void>> {
  const empty = verifyEmptyResponse(policy, controller);
  return Promise.resolve(empty);
}

/**
 * Read the cloned branch under the policy, then release its lock.
 * @param request - Reader and response being checked.
 * @param policy - Validated response-integrity policy.
 * @returns Success or a fixed, body-free refusal.
 */
function verifyRead(request: IVerification, policy: IResponseIntegrity): Promise<Procedure<void>> {
  const state = integrityStateOf(request.response, request.reader, policy);
  const reading = consume(state);
  return withCleanup(request, reading);
}

/**
 * Verifies a response body before its ordinary reader decodes it.
 * @param response - Response whose original body remains available on success.
 * @param policy - Validated response-integrity policy.
 * @param controller - Request-local abort controller.
 * @returns Success or a fixed, body-free refusal.
 */
function verifyResponseIntegrity(
  response: Response,
  policy: IResponseIntegrity,
  controller: AbortController,
): Promise<Procedure<void>> {
  const reader = response.clone().body?.getReader();
  if (reader === undefined) return verifyEmptyRead(policy, controller);
  const request = { response, reader, controller };
  return verifyRead(request, policy);
}

export default verifyResponseIntegrity;
export { verifyResponseIntegrity };
