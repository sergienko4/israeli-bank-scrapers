/**
 * Non-blocking graceful end for a retired `ThreadStream` worker.
 *
 * `ThreadStream.flush()` acknowledges that the worker consumed the ring
 * buffer, not that each destination behind it (`pino/file`, `pino-pretty`,
 * multi-target multistreams) finished writing. Terminating the worker at that
 * point drops buffered pretty output, while `ThreadStream.end()` drains the
 * destinations but blocks the main event loop in an `Atomics.wait` loop.
 *
 * The shared ring buffer already carries an end signal: storing `-1` in
 * `WRITE_INDEX` makes the worker call `destination.end()`, which flushes every
 * target and closes it before the worker exits. Reaching that word only needs
 * the private state record the `ThreadStream` constructor installs under the
 * `kImpl` symbol, so this module reads it, reports whether the request could be
 * made, and lets {@link ./RetireTransport.ts | RetireTransport} keep
 * `worker.terminate()` as the bounded fallback for an unavailable handshake or
 * destinations that never close.
 *
 * <p>Order matters. `flush()` reads `WRITE_INDEX` at call time, so it resolves
 * immediately while `buf` still holds unwritten records, and the worker treats
 * `-1` as "end now" without draining bytes still in the ring buffer. The marker
 * is therefore stored only once `buf` is empty and `READ_INDEX` has caught up
 * with `WRITE_INDEX`.
 */

/** Outcome of asking a retired worker to end its destinations. */
export type WorkerEndOutcome = 'ended' | 'busy' | 'unsupported';

/** `WRITE_INDEX` word inside `ThreadStream`'s shared `Int32Array` state. */
const WRITE_INDEX = 4;

/** `READ_INDEX` word inside `ThreadStream`'s shared `Int32Array` state. */
const READ_INDEX = 8;

/** Worker end-of-stream marker stored at {@link WRITE_INDEX}. */
const END_MARKER = -1;

/** Symbol description `ThreadStream` gives its private state record. */
const IMPL_SYMBOL = 'kImpl';

/** `ThreadStream` state fields the end handshake reads and writes. */
interface IWorkerEndState {
  readonly state: Int32Array;
  ending: boolean;
  readonly flushing: boolean;
  readonly buf: string;
}

/**
 * Find the `kImpl` own-property symbol on `stream`.
 * @param stream - Candidate transport stream.
 * @returns The symbol when present, else `false`.
 */
function findImplSymbol(stream: object): symbol | false {
  const symbols = Object.getOwnPropertySymbols(stream);
  return symbols.find((symbol): boolean => symbol.description === IMPL_SYMBOL) ?? false;
}

/**
 * Check that `impl` carries every field the end handshake touches.
 * @param impl - Candidate state record read off the stream symbol.
 * @returns True when the record matches `ThreadStream`'s shape.
 */
function isWorkerEndState(impl: IWorkerEndState | false): impl is IWorkerEndState {
  if (!impl) return false;
  const hasState = impl.state instanceof Int32Array;
  const hasFlags = typeof impl.flushing === 'boolean' && typeof impl.ending === 'boolean';
  return hasState && hasFlags && typeof impl.buf === 'string';
}

/**
 * Read `ThreadStream`'s private state record when it has the needed fields.
 * @param stream - Candidate transport stream.
 * @returns The state record, or `false` when this stream version differs.
 */
function readWorkerEndState(stream: object): IWorkerEndState | false {
  const symbol = findImplSymbol(stream);
  if (!symbol) return false;
  const impl = Reflect.get(stream, symbol) as IWorkerEndState | false;
  return isWorkerEndState(impl) ? impl : false;
}

/**
 * Check whether the worker has consumed every byte of the ring buffer.
 * @param impl - Validated `ThreadStream` state record.
 * @returns True when `READ_INDEX` has caught up with `WRITE_INDEX`.
 */
function isRingBufferConsumed(impl: IWorkerEndState): boolean {
  const readIndex = Atomics.load(impl.state, READ_INDEX);
  return readIndex === Atomics.load(impl.state, WRITE_INDEX);
}

/**
 * Store the end marker so the worker ends every destination before exiting.
 * @param impl - Validated `ThreadStream` state record.
 * @returns Always true.
 */
function storeEndMarker(impl: IWorkerEndState): true {
  impl.ending = true;
  Atomics.store(impl.state, WRITE_INDEX, END_MARKER);
  Atomics.notify(impl.state, WRITE_INDEX);
  return true;
}

/**
 * Ask a retired worker to end its destinations without blocking this thread.
 *
 * <p>`busy` means buffered records are still waiting for `nextFlush` (marking
 * the stream `ending` first would make `ThreadStream` run its blocking `end()`)
 * or the worker has not yet consumed the ring buffer (the `-1` marker would
 * make it discard those bytes). Callers retry until both have drained, which is
 * the queued-write drain they already wait for.
 * @param stream - Owned `ThreadStream` from the superseded root logger.
 * @returns `ended` when the marker was stored, `busy` when the caller must
 * retry, or `unsupported` when the private state is unavailable.
 */
export function requestWorkerEnd(stream: object): WorkerEndOutcome {
  const impl = readWorkerEndState(stream);
  if (!impl) return 'unsupported';
  if (impl.flushing || impl.buf.length > 0) return 'busy';
  if (!isRingBufferConsumed(impl)) return 'busy';
  storeEndMarker(impl);
  return 'ended';
}
