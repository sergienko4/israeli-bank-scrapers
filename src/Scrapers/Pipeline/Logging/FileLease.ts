/**
 * Owned file-descriptor lease for `pipeline.log` worker transports.
 *
 * `ThreadStream` spawns workers with `trackUnmanagedFds: false`, so terminating
 * a worker thread never closes a raw descriptor opened inside the worker by
 * `SonicBoom`, and `ThreadStream.flush()` resolves as soon as the worker accepts
 * a chunk into user-space buffer rather than when `fs.write` completes. Owning
 * the append descriptor on the main thread lets retirement verify all serialized
 * bytes reached disk (`fs.fstat`) and close the descriptor deterministically
 * after the worker exits.
 *
 * <p>The descriptor is shared with the transport worker, so closure is not the
 * main thread's alone: a graceful end runs `SonicBoom.end()` inside the worker,
 * which closes the same descriptor. `closeFileLeaseAsync` therefore checks that
 * `lease.fd` still names the leased file before closing it, and treats an
 * already-closed or reused number as settled without issuing a second
 * `fs.close`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { toError } from '../Types/ErrorUtils.js';

/** Owned file-descriptor lease tracking expected byte flush and async `fs.close`. */
export interface IFileLease {
  readonly fd: number;
  /** Device id captured when `fd` was opened, used to recognise a reused descriptor. */
  readonly dev: number;
  /** Inode number captured when `fd` was opened, used to recognise a reused descriptor. */
  readonly ino: number;
  targetBytes: number;
  isFrozen: boolean;
  isClosing: boolean;
  isClosed: boolean;
}

/** Callbacks supplied by `RootLogger` to construct a leased file-backed Pino instance. */
export interface ILeasedLoggerHooks {
  readonly logFile: string;
  readonly buildPreferredOptions: (fd: number) => pino.LoggerOptions;
  readonly buildFallbackOptions: (fd: number) => pino.LoggerOptions;
  readonly onTransportFailure: (error: Error) => boolean;
  readonly buildSilentFallback: (error: Error) => Logger;
}

/**
 * Build the non-descriptor half of a fresh lease from its `fstat` snapshot.
 * @param stats - Statistics captured for the descriptor.
 * @returns Lease flags with the initial byte target and lifecycle state.
 */
function leaseFlags(stats: fs.Stats): Omit<IFileLease, 'fd'> {
  return {
    dev: stats.dev,
    ino: stats.ino,
    targetBytes: stats.size,
    isFrozen: false,
    isClosing: false,
    isClosed: false,
  };
}

/**
 * Build a fresh lease around an open `fd`, closing `fd` if `fstatSync` throws.
 * @param fd - Newly opened append file descriptor.
 * @returns Initialized file-descriptor lease.
 */
function statOpenFd(fd: number): IFileLease {
  try {
    const stats = fs.fstatSync(fd);
    const flags = leaseFlags(stats);
    return { fd, ...flags };
  } catch (error_) {
    fs.closeSync(fd);
    throw error_;
  }
}

/**
 * Open an append-mode descriptor for `logFile` and record its initial byte size.
 * @param logFile - Resolved `pipeline.log` file path.
 * @returns Initialized file-descriptor lease.
 */
function openRawLease(logFile: string): IFileLease {
  const dir = path.dirname(logFile);
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  return statOpenFd(fd);
}

/**
 * Synchronously close an unused file lease when logger construction degrades to silent.
 * @param lease - Owned file lease (or `false`).
 * @returns True when closed, false when absent or already closed.
 */
function closeFileLeaseSync(lease: IFileLease | false): boolean {
  if (!lease || lease.isClosing || lease.isClosed) return false;
  lease.isClosing = true;
  fs.closeSync(lease.fd);
  lease.isClosed = true;
  return true;
}

/**
 * Build Pino's `hooks.streamWrite` callback counting bytes sent to `lease`.
 * @param lease - Owned file lease receiving serialized log records.
 * @returns Stream-write hook returning each serialized line unchanged.
 */
function makeLeaseStreamWriteHook(lease: IFileLease): (line: string) => string {
  return (line: string): string => {
    if (!lease.isFrozen) lease.targetBytes += Buffer.byteLength(line);
    return line;
  };
}

/**
 * Attach byte-counting `hooks` onto `baseOptions` for `lease`.
 * @param baseOptions - Base Pino options targeting `lease.fd`.
 * @param lease - Owned file lease.
 * @returns Pino options wired with `streamWrite` byte accounting.
 */
/**
 * Invoke `buildOptions(lease.fd)` and wire `streamWrite` byte accounting onto the result.
 * @param buildOptions - Option builder for `lease.fd`.
 * @param lease - Owned file lease.
 * @returns Pino options wired with `streamWrite` byte accounting.
 */
function buildLeaseWiredOptions(
  buildOptions: (fd: number) => pino.LoggerOptions,
  lease: IFileLease,
): pino.LoggerOptions {
  const baseOptions = buildOptions(lease.fd);
  const hooks = { streamWrite: makeLeaseStreamWriteHook(lease) };
  return { ...baseOptions, hooks };
}

/** Result of constructing a leased file-backed Pino logger. */
export interface ILeasedLoggerResult {
  readonly logger: Logger;
  readonly lease: IFileLease | false;
}

/** No-op writable sink used to pre-validate Pino options without opening a transport. */
const VALIDATION_SINK: pino.DestinationStream = {
  /**
   * Discard serialized validation output.
   * @returns Always true.
   */
  write: (): boolean => true,
};

/**
 * Construct a Pino instance from `options` (pre-validating non-transport fields
 * before spawning a worker) and wrap it with `lease`.
 * @param options - Pino options wired with `lease`.
 * @param lease - Open file lease.
 * @returns Leased logger result.
 */
function createLeasedPino(options: pino.LoggerOptions, lease: IFileLease): ILeasedLoggerResult {
  const checkOptions: pino.LoggerOptions = { ...options };
  delete checkOptions.transport;
  pino(checkOptions, VALIDATION_SINK);
  const logger = pino(options);
  return { logger, lease };
}

/**
 * Fall back to file-only Pino options (or silent on double failure, closing `lease`).
 * @param lease - Open file lease.
 * @param cfg - Builder and degradation hooks from `RootLogger`.
 * @returns Degraded file logger or silent fallback.
 */
function degradeLeasedLogger(lease: IFileLease, cfg: ILeasedLoggerHooks): ILeasedLoggerResult {
  const fallback = buildLeaseWiredOptions(cfg.buildFallbackOptions, lease);
  try {
    return createLeasedPino(fallback, lease);
  } catch (error_) {
    closeFileLeaseSync(lease);
    const error = toError(error_);
    return { logger: cfg.buildSilentFallback(error), lease: false };
  }
}

/**
 * Construct a Pino instance on an already-open `lease`, degrading on transport failure.
 * @param lease - Open file lease.
 * @param cfg - Builder and degradation hooks from `RootLogger`.
 * @returns Built logger paired with its active lease (or `false` if silent).
 */
function buildPinoWithLease(lease: IFileLease, cfg: ILeasedLoggerHooks): ILeasedLoggerResult {
  const preferred = buildLeaseWiredOptions(cfg.buildPreferredOptions, lease);
  try {
    return createLeasedPino(preferred, lease);
  } catch (error_) {
    const error = toError(error_);
    cfg.onTransportFailure(error);
    return degradeLeasedLogger(lease, cfg);
  }
}

/**
 * Handle an unrecoverable open/build failure by closing `lease` and returning silent fallback.
 * @param lease - Open file lease (or `false`).
 * @param rawError - Thrown failure.
 * @param cfg - Degradation hooks from `RootLogger`.
 * @returns Silent logger fallback result.
 */
function fallbackFromOpenFailure(
  lease: IFileLease | false,
  rawError: Error,
  cfg: ILeasedLoggerHooks,
): ILeasedLoggerResult {
  closeFileLeaseSync(lease);
  cfg.onTransportFailure(rawError);
  return { logger: cfg.buildSilentFallback(rawError), lease: false };
}

/**
 * Open an owned file lease for `cfg.logFile` and construct its Pino logger.
 * @param cfg - File path plus option builders and degradation callbacks.
 * @returns Root logger paired with its owned file lease (or `false` if silent).
 */
export function instantiateLeasedFileLogger(cfg: ILeasedLoggerHooks): ILeasedLoggerResult {
  let lease: IFileLease | false = false;
  try {
    lease = openRawLease(cfg.logFile);
    return buildPinoWithLease(lease, cfg);
  } catch (error_) {
    const error = toError(error_);
    return fallbackFromOpenFailure(lease, error, cfg);
  }
}

/** Branded boolean returned when `awaitLeaseFlush` schedules a poll or settles. */
export type DidAwaitLeaseFlush = Brand<boolean, 'DidAwaitLeaseFlush'>;

/** Lease (or `false` when terminal-only), poll interval, and completion callback. */
export interface ILeaseFlushWait {
  readonly lease: IFileLease | false;
  readonly pollMs: number;
  readonly onSettled: (reason?: string) => boolean;
}

/**
 * Wait asynchronously until every byte written through `wait.lease` reaches disk,
 * retrying on an unref'd timer so a stalled writer never holds the event loop.
 * @param wait - Lease, poll interval, and completion callback.
 * @returns Branded true once the completion callback or a retry is scheduled.
 */
export function awaitLeaseFlush(wait: ILeaseFlushWait): DidAwaitLeaseFlush {
  const { lease } = wait;
  if (!lease || lease.isClosed) return wait.onSettled() as DidAwaitLeaseFlush;
  fs.fstat(lease.fd, (statErr, stats): boolean => {
    if (statErr) return wait.onSettled(statErr.message);
    return stats.size >= lease.targetBytes ? wait.onSettled() : retryLeaseFlush(wait);
  });
  return true as DidAwaitLeaseFlush;
}

/**
 * Schedule an unref'd retry of {@link awaitLeaseFlush} after `wait.pollMs`.
 * @param wait - Lease, poll interval, and completion callback.
 * @returns Always true.
 */
function retryLeaseFlush(wait: ILeaseFlushWait): true {
  const timer = globalThis.setTimeout((): DidAwaitLeaseFlush => awaitLeaseFlush(wait), wait.pollMs);
  const unref = typeof timer === 'object' ? (timer as { unref?: () => object }).unref : undefined;
  if (typeof unref === 'function') unref.call(timer);
  return true;
}
