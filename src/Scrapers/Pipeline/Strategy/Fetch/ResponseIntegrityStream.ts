/**
 * Bounded stream read for response integrity — limits the bytes of a cloned
 * body, hashes them as they arrive and keeps a failure prefix for WAF
 * classification.
 *
 * Split out of ResponseIntegrityReader.ts so both files stay under the
 * per-file LOC ceiling: that module owns the verdict and the cleanup, this one
 * owns the read itself. Nothing here decides whether a response is acceptable —
 * it reports the digest state and the fixed refusals the reader commits.
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

/** Prefix of a failed response, kept only to classify a WAF block. */
interface IFailurePreview {
  readonly status: number;
  readonly decoder: TextDecoder;
  text: string;
}

/** Request-local state of one bounded read. */
interface IReaderState {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly policy: IResponseIntegrity;
  readonly hash: Hash;
  readonly preview?: IFailurePreview;
  bytes: number;
}

/** Reader state plus the callbacks that settle the surrounding promise. */
interface IReaderLoop extends IReaderState {
  readonly complete: (result: Procedure<void>) => boolean;
  readonly reject: (error: unknown) => boolean;
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
    return state.complete(result);
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
 * Build the callback that settles a read with its verdict.
 * @param resolve - The collection's resolve.
 * @returns A completion callback answering true once resolved.
 */
function completionFor(
  resolve: (result: Procedure<void>) => unknown,
): (result: Procedure<void>) => boolean {
  return result => {
    resolve(result);
    return true;
  };
}

/**
 * Build the callback that settles a read with its stream failure.
 * @param reject - The collection's reject.
 * @returns A rejection callback answering true once rejected.
 */
function rejectionFor(reject: (error: Error) => unknown): (error: unknown) => boolean {
  return error => {
    const normalized = normalizeStreamError(error);
    reject(normalized);
    return true;
  };
}

/**
 * Open the prefix buffer that will hold a failed response's WAF body.
 * @param response - Response under verification.
 * @returns A buffer labelled with the response's status.
 */
function previewFor(response: Response): IFailurePreview {
  const decoder = new TextDecoder();
  return { status: response.status, decoder, text: '' };
}

/**
 * Assemble the integrity read state for one response.
 * @param response - Response under verification.
 * @param reader - Reader of the cloned body branch.
 * @param policy - Validated response-integrity policy.
 * @returns Reader state carrying a fresh digest.
 */
function integrityStateOf(
  response: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  policy: IResponseIntegrity,
): IReaderState {
  const hash = createHash('sha256');
  const preview = response.ok ? undefined : previewFor(response);
  return { reader, policy, preview, hash, bytes: 0 };
}

/**
 * Reads a stream without buffering beyond the configured byte limit.
 * @param state - Request-local reader state.
 * @returns The integrity result.
 */
function consume(state: IReaderState): Promise<Procedure<void>> {
  return new Promise((resolve, reject) => {
    const complete = completionFor(resolve);
    const failStream = rejectionFor(reject);
    const loop = { ...state, complete, reject: failStream };
    return readNext(loop);
  });
}

export type { IReaderState };
export { consume, integrityStateOf };
