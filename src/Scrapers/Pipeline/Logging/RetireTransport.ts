/**
 * Non-blocking worker-transport retirement for superseded root Pino loggers.
 *
 * Waits for queued ring-buffer records to reach the worker, then asks the worker
 * to end every destination gracefully — `pino/file`, `pino-pretty`, and multi-target
 * multistreams all flush and close before the worker exits. Terminating the worker
 * is only the bounded fallback when the graceful handshake is unavailable or a
 * destination never closes. Never invokes `ThreadStream.prototype.end()`, whose
 * `Atomics.wait` loop can block the main event loop for up to 10 seconds.
 */

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { toError } from '../Types/ErrorUtils.js';
import { awaitLeaseFlush, type IFileLease, type ILeaseFlushWait } from './FileLease.js';
import { closeFileLeaseAsync, markLeaseClosedByWorker } from './FileLeaseClose.js';
import {
  emitRetiredDrainWarning,
  handleTerminateRejection,
  type IRetirementState,
  makeRetiredErrorListener,
} from './RetireWarnings.js';
import { requestWorkerEnd } from './RetireWorkerEnd.js';

/** Branded boolean returned when a superseded worker transport was scheduled for retirement. */
export type DidRetireLogger = Brand<boolean, 'DidRetireLogger'>;

/** Poll interval (ms) while waiting for a retired stream to become idle. */
const RETIRE_POLL_MS = 5;

/** Default timeout (ms) before forcibly terminating a stalled retired worker. */
const RETIRED_FLUSH_TIMEOUT_MS = 5_000;

/**
 * Candidate stream shape read off `pino.symbols.streamSym` when retiring a
 * superseded root logger. Worker transports (`ThreadStream`) omit `fd` and
 * expose `.flush()` (fallback drain) + `.worker.terminate()`, whereas Pino's
 * default stdout `SonicBoom` carries `fd: 1` and must never be closed.
 */
export interface IPinoStreamCandidate {
  readonly fd?: number;
  readonly closed?: boolean;
  readonly destroyed?: boolean;
  readonly flush?: (cb: (err?: Error) => boolean) => boolean | object;
  readonly unref?: () => boolean | object;
  readonly on?: (event: 'error', listener: (err: Error) => boolean) => object;
  readonly once?: (event: 'close', listener: () => boolean) => object;
  readonly worker?: { readonly terminate: () => Promise<number> };
}

interface IRetirementCtx {
  readonly stream: IPinoStreamCandidate;
  readonly lease: IFileLease | false;
  readonly state: IRetirementState;
}

/**
 * Release the lease once the worker is gone. After a graceful end the worker has
 * closed the shared descriptor, so it is only recorded as closed; closing the
 * number again could close another file's descriptor that now reuses it. Any
 * other exit, including a close that follows a worker error, cannot say whether
 * the worker closed it, so the lease is closed only while `fstat` still shows
 * the file it opened.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True when `fs.close` was scheduled, else false.
 */
function releaseLease(ctx: IRetirementCtx): boolean {
  const { isWorkerEnded, hasWorkerFailed } = ctx.state;
  if (isWorkerEnded && !hasWorkerFailed) return markLeaseClosedByWorker(ctx.lease);
  return closeFileLeaseAsync(ctx.lease, emitRetiredDrainWarning);
}

/**
 * Terminate an open retired worker thread and release any owned file descriptor
 * only after the worker thread has exited (see {@link releaseLease}).
 * @param ctx - Retirement stream, optional file lease, and lifecycle state.
 * @returns True when termination was initiated, false when already closed.
 */
function terminateStreamWorker(ctx: IRetirementCtx): boolean {
  /**
   * Release `ctx.lease` asynchronously after worker teardown settles.
   * @returns True when `fs.close` was scheduled, else false.
   */
  const release = (): boolean => releaseLease(ctx);
  if (ctx.stream.closed) return release();
  ctx.state.isTerminating = true;
  ctx.stream.unref?.();
  const termination = ctx.stream.worker?.terminate();
  if (!termination) return release();
  termination.catch(handleTerminateRejection).finally(release);
  return true;
}

/**
 * Settle retirement at most once, clearing the watchdog timer before terminating.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @param failureReason - Optional drain/timeout failure message to warn about.
 * @returns True when worker termination was initiated, else false.
 */
function finalizeStreamRetirement(ctx: IRetirementCtx, failureReason?: string): boolean {
  if (ctx.state.isSettled) return false;
  ctx.state.isSettled = true;
  if (ctx.state.timer !== undefined) globalThis.clearTimeout(ctx.state.timer);
  if (failureReason) emitRetiredDrainWarning(failureReason);
  return terminateStreamWorker(ctx);
}

/**
 * Wait for `ctx.lease` bytes to reach disk, then finalize retirement. Legacy
 * fallback used when this `ThreadStream` version has no private end signal.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True once the lease poll or finalization is scheduled.
 */
function awaitLeaseDrain(ctx: IRetirementCtx): boolean {
  const wait: ILeaseFlushWait = {
    lease: ctx.lease,
    pollMs: RETIRE_POLL_MS,
    onSettled: makeRetireSettled(ctx),
  };
  return awaitLeaseFlush(wait);
}

/**
 * Build the lease-flush completion callback for `ctx`.
 * @param ctx - Retirement stream and lifecycle state.
 * @returns Callback finalizing retirement with an optional failure reason.
 */
function makeRetireSettled(ctx: IRetirementCtx): (reason?: string) => boolean {
  return (reason?: string): boolean => finalizeStreamRetirement(ctx, reason);
}

/**
 * Build the fallback flush callback for `ctx`: settle on a flush error, else
 * continue draining the owned file lease before terminating.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns Callback for `ThreadStream.flush`.
 */
function makeFallbackFlushCallback(ctx: IRetirementCtx): (flushError?: Error) => boolean {
  return (flushError?: Error): boolean =>
    flushError ? finalizeStreamRetirement(ctx, toError(flushError).message) : awaitLeaseDrain(ctx);
}

/**
 * Fallback drain for a `ThreadStream` version without the private end signal:
 * wait for the async flush acknowledgement, then the owned lease, then settle.
 * `worker.terminate()` still bounds a flush that never resolves.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True once the flush wait or finalization is scheduled.
 */
function awaitFlushFallback(ctx: IRetirementCtx): boolean {
  if (typeof ctx.stream.flush !== 'function') return awaitLeaseDrain(ctx);
  const onFlushed = makeFallbackFlushCallback(ctx);
  ctx.stream.flush(onFlushed);
  return true;
}

/**
 * Retry {@link beginGracefulEnd} on an unref'd timer while the worker still
 * consumes queued records.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns Always true.
 */
function retryGracefulEnd(ctx: IRetirementCtx): true {
  const timer = globalThis.setTimeout((): boolean => beginGracefulEnd(ctx), RETIRE_POLL_MS);
  const unref = typeof timer === 'object' ? (timer as { unref?: () => object }).unref : undefined;
  if (typeof unref === 'function') unref.call(timer);
  return true;
}

/**
 * Settle retirement after the worker closed following a graceful end request.
 * A close that arrives after another path already settled (an error, the
 * watchdog) says nothing about the descriptor, so it is not marked as ended.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True when worker termination was initiated, else false.
 */
function finalizeGracefulEnd(ctx: IRetirementCtx): boolean {
  if (ctx.state.isSettled) return false;
  ctx.state.isWorkerEnded = true;
  return finalizeStreamRetirement(ctx);
}

/**
 * Ask the worker to end its destinations once every queued record has reached
 * it, retrying while the main-thread buffer or ring buffer still holds bytes,
 * and settle once the worker has flushed and closed every destination.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True once the end request or a retry/fallback was scheduled.
 */
function beginGracefulEnd(ctx: IRetirementCtx): boolean {
  if (ctx.state.isSettled) return false;
  const outcome = requestWorkerEnd(ctx.stream);
  if (outcome === 'busy') return retryGracefulEnd(ctx);
  if (outcome === 'unsupported') return awaitFlushFallback(ctx);
  ctx.stream.once?.('close', (): boolean => finalizeGracefulEnd(ctx));
  return true;
}

/**
 * Begin draining a retired `ThreadStream` on the next event-loop turn.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @returns True once async drain or termination has started.
 */
function beginAsyncStreamDrain(ctx: IRetirementCtx): boolean {
  if (ctx.state.isSettled || ctx.stream.closed || ctx.stream.destroyed) {
    return finalizeStreamRetirement(ctx);
  }
  return beginGracefulEnd(ctx);
}

/**
 * Arm the unref'd watchdog timer that bounds async drain duration.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @param timeoutMs - Maximum drain window in milliseconds.
 * @returns Armed timeout handle.
 */
function armRetirementWatchdog(
  ctx: IRetirementCtx,
  timeoutMs: number,
): NonNullable<IRetirementState['timer']> {
  /**
   * Force non-blocking worker termination when async drain exceeds `timeoutMs`.
   * @returns True when termination started, else false.
   */
  const onTimeout = (): boolean => finalizeStreamRetirement(ctx, 'worker drain timed out');
  const timer = globalThis.setTimeout(onTimeout, timeoutMs);
  const unref = typeof timer === 'object' ? (timer as { unref?: () => object }).unref : undefined;
  if (typeof unref === 'function') unref.call(timer);
  return timer;
}

/**
 * Create initial retirement context and attach the retired-stream error listener.
 * @param stream - Owned `ThreadStream` from the superseded root logger.
 * @param lease - Optional owned file-descriptor lease for `pipeline.log`.
 * @returns Initialized retirement context.
 */
function createRetirementCtx(
  stream: IPinoStreamCandidate,
  lease: IFileLease | false,
): IRetirementCtx {
  if (lease) lease.isFrozen = true;
  const ctx: IRetirementCtx = { stream, lease, state: { isSettled: false, isTerminating: false } };
  const errorListener = makeRetiredErrorListener(ctx.state);
  stream.on?.('error', errorListener);
  return ctx;
}

/**
 * Drain a retired `ThreadStream`, end every destination, and terminate the
 * worker only when the graceful end exceeds `timeoutMs` — never calling the
 * synchronous `Atomics.wait`-backed `end()` on the main event loop.
 * @internal
 * @param stream - Owned `ThreadStream` from the superseded root logger.
 * @param timeoutMs - Bounded drain window before forcing worker termination.
 * @param lease - Optional owned file-descriptor lease closed after worker exit.
 * @returns True after scheduling non-blocking retirement.
 */
export function scheduleStreamClose(
  stream: IPinoStreamCandidate,
  timeoutMs: number = RETIRED_FLUSH_TIMEOUT_MS,
  lease: IFileLease | false = false,
): true {
  const ctx = createRetirementCtx(stream, lease);
  ctx.state.timer = armRetirementWatchdog(ctx, timeoutMs);
  setImmediate((): boolean => beginAsyncStreamDrain(ctx)).unref();
  return true;
}

/**
 * Read an owned `ThreadStream` off `previous`, flushing it when present.
 * @param previous - Superseded root logger (or `false`).
 * @returns Owned worker stream when retirable, else `false`.
 */
function extractRetirableStream(previous: Logger | false): IPinoStreamCandidate | false {
  if (!previous) return false;
  previous.flush();
  const candidate = Reflect.get(previous, pino.symbols.streamSym) as IPinoStreamCandidate | false;
  if (!candidate || typeof candidate.fd === 'number') return false;
  return typeof candidate.worker?.terminate === 'function' ? candidate : false;
}

/**
 * Flush a superseded root logger and schedule its owned worker transport (if
 * any) and file lease for non-blocking destination drain, worker end (or the
 * bounded termination fallback), and `fs.close`.
 * @param previous - Superseded root logger (or `false` on first build).
 * @param lease - Owned file-descriptor lease paired with `previous` (or `false`).
 * @returns Branded boolean true when a worker transport was scheduled for retirement.
 */
export function retireSupersededLogger(
  previous: Logger | false,
  lease: IFileLease | false,
): DidRetireLogger {
  const stream = extractRetirableStream(previous);
  if (stream)
    return scheduleStreamClose(stream, RETIRED_FLUSH_TIMEOUT_MS, lease) as DidRetireLogger;
  closeFileLeaseAsync(lease, emitRetiredDrainWarning);
  return false as DidRetireLogger;
}
