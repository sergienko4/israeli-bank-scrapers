/**
 * Limits and verifies fetch response bytes while retaining the original response.
 */

import { createHash, type Hash } from 'node:crypto';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { getDebug } from '../../Logging/Debug.js';
import type { IResponseIntegrity } from '../../Types/Domain/FetchPolicy.js';
import {
  RESPONSE_BYTE_LIMIT_REASON,
  RESPONSE_DIGEST_MISMATCH_REASON,
} from '../../Types/Domain/FetchPolicy.js';
import { toError } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { CLOUDFLARE_BLOCK_REASON, isCloudflareBlock } from './HttpFailureClassifier.js';
import { failResponseIntegrity } from './ResponseIntegrityCheck.js';

const LOG = getDebug(import.meta.url);

interface IFailurePreview {
  readonly status: number;
  readonly decoder: TextDecoder;
  text: string;
}

interface IReaderState {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly policy: IResponseIntegrity;
  readonly hash: Hash;
  readonly preview?: IFailurePreview;
  bytes: number;
}

interface IReaderLoop extends IReaderState {
  readonly complete: (result: Procedure<void>) => boolean;
  readonly reject: (error: unknown) => boolean;
}

interface IVerification {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly controller: AbortController;
}

/**
 * Keeps only the allowed prefix of a failed response for WAF classification.
 * @param state - Request-local reader state.
 * @param chunk - Post-decompression bytes.
 * @returns Whether a failure prefix was captured.
 */
function captureFailurePrefix(state: IReaderState, chunk: Uint8Array): boolean {
  if (state.preview === undefined) return false;
  const remaining = state.policy.maxBytes - state.bytes;
  const prefix = chunk.subarray(0, remaining);
  state.preview.text += state.preview.decoder.decode(prefix, { stream: true });
  return true;
}

/**
 * Preserves a recognizable WAF block without exposing its bounded prefix.
 * @param preview - Captured failure prefix, if any.
 * @returns A terminal WAF block or a fixed byte-limit refusal.
 */
function overflowRefusal(preview?: IFailurePreview): Procedure<void> {
  if (preview && isCloudflareBlock(preview.status, preview.text)) {
    return fail(ScraperErrorTypes.WafBlocked, CLOUDFLARE_BLOCK_REASON);
  }
  return failResponseIntegrity(RESPONSE_BYTE_LIMIT_REASON);
}

/**
 * Adds one stream chunk to the integrity state.
 * @param state - Request-local reader state.
 * @param chunk - Post-decompression bytes.
 * @returns A refusal if the limit has been crossed.
 */
function addChunk(state: IReaderState, chunk: Uint8Array): Procedure<void> {
  captureFailurePrefix(state, chunk);
  state.bytes += chunk.byteLength;
  if (state.bytes > state.policy.maxBytes) return overflowRefusal(state.preview);
  state.hash.update(chunk);
  return succeed(undefined);
}

/**
 * Compares the digest after the entire bounded body has been read.
 * @param state - Completed reader state.
 * @returns A fixed refusal on mismatch.
 */
function finish(state: IReaderState): Procedure<void> {
  const digest = state.hash.digest('hex');
  if (state.policy.sha256 !== undefined && digest !== state.policy.sha256) {
    return failResponseIntegrity(RESPONSE_DIGEST_MISMATCH_REASON);
  }
  return succeed(undefined);
}

/**
 * Schedules the next chunk without retaining a chain of pending promises.
 * @param state - Request-local reader state and completion callbacks.
 * @returns True once the read is scheduled.
 */
function readNext(state: IReaderLoop): boolean {
  state.reader
    .read()
    .then(chunk => acceptChunk(state, chunk))
    .catch(state.reject);
  return true;
}

/**
 * Handles a stream chunk or completes the read.
 * @param state - Request-local reader state and completion callbacks.
 * @param chunk - The reader's next result.
 * @returns True when the result was handled.
 */
function acceptChunk(state: IReaderLoop, chunk: ReadableStreamReadResult<Uint8Array>): boolean {
  if (chunk.done) {
    const result = finish(state);
    state.complete(result);
    return true;
  }
  const added = addChunk(state, chunk.value);
  if (isOk(added)) return readNext(state);
  state.complete(added);
  return true;
}

/**
 * Preserves an abort classification when normalizing a foreign-realm error.
 * @param error - The rejected stream value.
 * @returns A normalized error with its timeout identity retained.
 */
function preserveStreamError(error: unknown): Error {
  const normalized = toError(error);
  if (typeof error !== 'object' || error === null) return normalized;
  const name: unknown = Reflect.get(error, 'name');
  if (name === 'AbortError' || name === 'TimeoutError') normalized.name = name;
  return normalized;
}

/**
 * Keeps unreadable rejection values from interrupting stream cleanup.
 * @param error - The rejected stream value.
 * @returns A normalized or fixed, body-free error.
 */
function normalizeStreamError(error: unknown): Error {
  try {
    return preserveStreamError(error);
  } catch {
    LOG.warn({ message: 'Response integrity stream error could not be inspected' });
    return new Error('response stream read failed');
  }
}

/**
 * Reads a stream without buffering beyond the configured byte limit.
 * @param state - Request-local reader state.
 * @returns The integrity result.
 */
function consume(state: IReaderState): Promise<Procedure<void>> {
  return new Promise((resolve, reject) => {
    /**
     * Completes the reader with its integrity verdict.
     * @param result - The verdict to return.
     * @returns True after resolving.
     */
    const complete = (result: Procedure<void>): boolean => {
      resolve(result);
      return true;
    };
    /**
     * Rejects the reader when its underlying stream fails.
     * @param error - The stream's rejection.
     * @returns True after rejecting.
     */
    const failStream = (error: unknown): boolean => {
      const normalized = normalizeStreamError(error);
      reject(normalized);
      return true;
    };
    return readNext({ ...state, complete, reject: failStream });
  });
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
  if (reader === undefined) {
    const result = verifyEmptyResponse(policy, controller);
    return Promise.resolve(result);
  }
  const request = { response, reader, controller };
  const preview = response.ok
    ? undefined
    : { status: response.status, decoder: new TextDecoder(), text: '' };
  const state = { reader, policy, preview, hash: createHash('sha256'), bytes: 0 };
  return consume(state)
    .then(result => finishRead(request, result))
    .catch((error: unknown) => failRead(request, error))
    .finally(() => {
      reader.releaseLock();
    });
}

export default verifyResponseIntegrity;
export { verifyResponseIntegrity };
