/**
 * Non-blocking worker-transport retirement for superseded root Pino loggers.
 *
 * Drains queued ring-buffer records via `ThreadStream`'s `Atomics.waitAsync`-backed
 * `flush()` (waiting for `'drain'` first when backpressured) and terminates the
 * worker thread asynchronously — never invoking `ThreadStream.prototype.end()`,
 * whose `Atomics.wait` loop can block the main event loop for up to 10 seconds
 * when a worker stalls.
 */

import * as fs from 'node:fs';

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { toError } from '../Types/ErrorUtils.js';
import { closeFileLeaseAsync, type IFileLease } from './FileLease.js';

/** Branded boolean returned when a superseded worker transport was scheduled for retirement. */
export type DidRetireLogger = Brand<boolean, 'DidRetireLogger'>;

/** Poll interval (ms) while waiting for `SonicBoom` to finish an in-flight `fs.write`. */
const LEASE_FLUSH_POLL_MS = 5;

/** Prefix emitted out-of-band when draining a retired worker transport fails. */
const RETIRED_DRAIN_FAILED = 'superseded log transport failed while draining:';

/** Default timeout (ms) before forcibly terminating a stalled retired worker. */
const RETIRED_FLUSH_TIMEOUT_MS = 5_000;

/** Expected `ThreadStream` errors emitted only when a stale unproxied caller writes post-close. */
const STALE_WORKER_MESSAGES = new Set(['the worker is ending', 'the worker has exited']);

/** Error message emitted by `ThreadStream` when `worker.terminate()` stops the worker. */
const WORKER_TERMINATED_MESSAGE = 'the worker thread exited';

/**
 * Candidate stream shape read off `pino.symbols.streamSym` when retiring a
 * superseded root logger. Worker transports (`ThreadStream`) omit `fd` and
 * expose `.flush()` + `.worker.terminate()`, whereas Pino's default stdout
 * `SonicBoom` carries `fd: 1` and must never be closed.
 */
export interface IPinoStreamCandidate {
  readonly fd?: number;
  readonly closed?: boolean;
  readonly destroyed?: boolean;
  readonly writableNeedDrain?: boolean;
  readonly flush?: (cb: (err?: Error) => boolean) => boolean | object;
  readonly unref?: () => boolean | object;
  readonly on?: (event: 'error', listener: (err: Error) => boolean) => object;
  readonly once?: (event: 'drain', listener: () => boolean) => object;
  readonly worker?: { readonly terminate: () => Promise<number> };
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface IRetirementState {
  isSettled: boolean;
  isTerminating: boolean;
  timer?: TimerHandle;
}

interface IRetirementCtx {
  readonly stream: IPinoStreamCandidate;
  readonly lease: IFileLease | false;
  readonly state: IRetirementState;
}

/**
 * Emit an out-of-band warning when retiring a superseded transport fails.
 * @param reason - Failure description surfaced via `process.emitWarning`.
 * @returns Always true.
 */
function emitRetiredDrainWarning(reason: string): true {
  process.emitWarning(`${RETIRED_DRAIN_FAILED} ${reason}`);
  return true;
}

/**
 * Report an asynchronous `worker.terminate()` rejection out-of-band.
 * @param rawError - Rejection value from `worker.terminate()`.
 * @returns Always true.
 */
function handleTerminateRejection(rawError: Error): true {
  const error = toError(rawError);
  return emitRetiredDrainWarning(error.message);
}

/**
 * Build the `'error'` listener guarding a retiring `ThreadStream`.
 * @param state - Mutable per-retirement lifecycle state.
 * @returns Listener suppressing stale-write/expected-exit noise while warning on real errors.
 */
function makeRetiredErrorListener(state: IRetirementState): (rawError: Error) => boolean {
  return (rawError: Error): boolean => {
    const error = toError(rawError);
    if (STALE_WORKER_MESSAGES.has(error.message)) return false;
    if (state.isTerminating && error.message === WORKER_TERMINATED_MESSAGE) return false;
    return emitRetiredDrainWarning(error.message);
  };
}

/**
 * Terminate an open retired worker thread and close any owned file descriptor
 * only after the worker thread has exited.
 * @param ctx - Retirement stream, optional file lease, and lifecycle state.
 * @returns True when termination was initiated, false when already closed.
 */
function terminateStreamWorker(ctx: IRetirementCtx): boolean {
  /**
   * Release `ctx.lease` asynchronously after worker teardown settles.
   * @returns True when `fs.close` was scheduled, else false.
   */
  const release = (): boolean => closeFileLeaseAsync(ctx.lease, emitRetiredDrainWarning);
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
  if (ctx.lease) ctx.lease.isFrozen = true;
  if (ctx.state.timer !== undefined) globalThis.clearTimeout(ctx.state.timer);
  if (failureReason) emitRetiredDrainWarning(failureReason);
  return terminateStreamWorker(ctx);
}

/**
 * Poll `ctx.lease` until all written bytes reach disk, then finalize retirement.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True once polling or finalization is scheduled.
 */
/**
 * Schedule an unref'd retry of `pollCtxLease(ctx)` after {@link LEASE_FLUSH_POLL_MS}.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns Always true.
 */
function retryCtxLeasePoll(ctx: IRetirementCtx): true {
  const timer = globalThis.setTimeout((): boolean => pollCtxLease(ctx), LEASE_FLUSH_POLL_MS);
  const unref = typeof timer === 'object' ? (timer as { unref?: () => object }).unref : undefined;
  if (typeof unref === 'function') unref.call(timer);
  return true;
}

/**
 * Poll `ctx.lease` until all written bytes reach disk, then finalize retirement.
 * @param ctx - Retirement stream, file lease, and lifecycle state.
 * @returns True once polling or finalization is scheduled.
 */
function pollCtxLease(ctx: IRetirementCtx): boolean {
  const { lease, state } = ctx;
  if (state.isSettled || !lease || lease.isClosed) return finalizeStreamRetirement(ctx);
  lease.isFrozen = true;
  fs.fstat(lease.fd, (statErr, stats): boolean => {
    if (statErr) return finalizeStreamRetirement(ctx, statErr.message);
    return stats.size >= lease.targetBytes ? finalizeStreamRetirement(ctx) : retryCtxLeasePoll(ctx);
  });
  return true;
}

/**
 * Build the `ThreadStream.flush` completion callback for `ctx`.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @returns Callback polling destination bytes (or finalizing on error) once flush resolves.
 */
function makeFlushCallback(ctx: IRetirementCtx): (flushError?: Error) => boolean {
  return (flushError?: Error): boolean =>
    flushError ? finalizeStreamRetirement(ctx, toError(flushError).message) : pollCtxLease(ctx);
}

/**
 * Invoke `stream.flush` (`Atomics.waitAsync`) and finalize retirement on completion.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @returns Always true.
 */
function flushStreamAsync(ctx: IRetirementCtx): true {
  if (typeof ctx.stream.flush !== 'function') {
    finalizeStreamRetirement(ctx);
    return true;
  }
  const onFlushed = makeFlushCallback(ctx);
  ctx.stream.flush(onFlushed);
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
  if (ctx.stream.writableNeedDrain && typeof ctx.stream.once === 'function') {
    ctx.stream.once('drain', (): boolean => flushStreamAsync(ctx));
    return true;
  }
  return flushStreamAsync(ctx);
}

/**
 * Arm the unref'd watchdog timer that bounds async drain duration.
 * @param ctx - Retirement stream and mutable lifecycle state.
 * @param timeoutMs - Maximum drain window in milliseconds.
 * @returns Armed timeout handle.
 */
function armRetirementWatchdog(ctx: IRetirementCtx, timeoutMs: number): TimerHandle {
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
  const ctx: IRetirementCtx = { stream, lease, state: { isSettled: false, isTerminating: false } };
  const errorListener = makeRetiredErrorListener(ctx.state);
  stream.on?.('error', errorListener);
  return ctx;
}

/**
 * Drain and terminate a retired `ThreadStream` asynchronously without calling
 * its synchronous `Atomics.wait`-backed `end()` on the main event loop.
 * @internal
 * @param stream - Owned `ThreadStream` from the superseded root logger.
 * @param timeoutMs - Bounded async drain window before forcing worker termination.
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
 * Check whether `stream` is an owned `ThreadStream` worker transport.
 * @param stream - Candidate Pino destination read off `pino.symbols.streamSym`.
 * @returns True when `stream` owns a terminable worker and is not a raw fd `SonicBoom`.
 */
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
 * any) and file lease for non-blocking drain, worker termination, and `fs.close`.
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
