/**
 * Lazy-built root pino instance + transport selection for the pipeline.
 *
 * The root logger is rebuilt the first time any module reads from it via
 * a {@link ./ChildLoggerProxy.ts | child proxy}; that "deferred-resolve"
 * shape lets pipeline code capture a `LOG` constant at module-load
 * without resolving the file destination too early — file transport
 * only resolves once `executePipeline` has opened the run's scope.
 *
 * Extracted from the legacy `Types/Debug.ts` blob during
 * Phase 12c.
 */

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { activeEnvironment, type IEnvironment } from '../Types/Environment.js';
import { isErrorLike, toError } from '../Types/ErrorUtils.js';
import { currentRunScope, noteRunLogFile } from '../Types/RunScope.js';
import { closeActiveRunTrace, getLogFile } from '../Types/TraceConfig.js';
import {
  type IFileLease,
  type ILeasedLoggerResult,
  instantiateLeasedFileLogger,
} from './FileLease.js';
import { generationFor, leaseFor, retireRunSlot, slotFor } from './LoggerSlots.js';
import {
  buildFdOptions,
  buildPinoOptions,
  buildPreferredFd,
  buildSilentOptions,
  buildTransport,
  optionsWithoutPretty,
} from './RootLoggerOptions.js';

export { buildPinoOptions, buildSilentOptions, buildTransport } from './RootLoggerOptions.js';

/** Whether a finished run owned a file destination that was retired (Rule #15). */
type DidRetireRunLogger = Brand<boolean, 'DidRetireRunLogger'>;

/** Brand for the root-logger generation counter (Rule #15). */
type RootLoggerGeneration = Brand<number, 'RootLoggerGeneration'>;

/** Opt-in flag for human-readable terminal output. */
const PRETTY_LOGS_ENV = 'PRETTY_LOGS';

/** Prefix of the out-of-band warning emitted when pretty output is unusable. */
const PRETTY_UNAVAILABLE =
  `${PRETTY_LOGS_ENV} was requested but the transport could not be built; ` +
  'continuing without it:';

/** Prefix used when the failing transport is not the pretty one. */
const TRANSPORT_UNAVAILABLE = 'log transport could not be built; continuing without it:';

/** Prefix used when even the degraded transport fails and logging goes silent. */
const FALLBACK_UNAVAILABLE = 'degraded log transport could not be built either; going silent:';

/**
 * Emit the degradation warning naming the transport that actually failed.
 * Blaming `PRETTY_LOGS` for a trace-file failure would send whoever reads
 * the warning after a flag they never set, so the flag is named only when
 * pretty output was the sole target and therefore the only candidate.
 * @param error - The failure thrown while constructing the transport.
 * @param logFile - Resolved log file path; a non-empty one means a second
 * target was present, so the failure is not attributable to pretty output.
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns True once the warning has been emitted.
 */
function warnTransportFailure(
  error: Error,
  logFile: string,
  env: IEnvironment = activeEnvironment(),
): true {
  const isPrettyOnly = env.prettyLogs && !logFile;
  const reason = isPrettyOnly ? PRETTY_UNAVAILABLE : TRANSPORT_UNAVAILABLE;
  process.emitWarning(`${reason} ${error.message}`);
  return true;
}

/**
 * Last-resort logger — no transport at all, so `pino()` has nothing left to
 * resolve and cannot fail a second time. This is what makes the "always
 * returns a usable logger" contract total rather than one level deep.
 * @param error - The failure thrown by the degraded transport.
 * @returns A silent but usable logger.
 */
function silentLogger(error: Error): Logger {
  process.emitWarning(`${FALLBACK_UNAVAILABLE} ${error.message}`);
  const silent = buildSilentOptions();
  return pino(silent);
}

/**
 * Build a pino logger, returning the construction error instead of throwing.
 * @param options - Pino options.
 * @returns The logger, or the construction error.
 */
function tryPino(options: pino.LoggerOptions): Logger | Error {
  try {
    return pino(options);
  } catch (error_) {
    return toError(error_);
  }
}

/**
 * Build the degraded logger, and if even that cannot be constructed fall
 * back to a transportless silent instance.
 * @param logFile - Resolved log file path, used to choose the fallback.
 * @param env - Environment snapshot for the degraded logger's level.
 * @returns A usable logger — the degraded one, or a silent one.
 */
function degradeLogger(logFile: string, env: IEnvironment): Logger {
  const options = optionsWithoutPretty(logFile, env);
  const built = tryPino(options);
  return isErrorLike(built) ? silentLogger(built) : built;
}

/**
 * Build a pino instance, degrading rather than failing when its transport
 * cannot be constructed.
 *
 * <p>A logger is a diagnostic aid; it must never be the thing that ends a
 * scrape. `pino()` throws synchronously when a transport target cannot be
 * resolved — a missing `pino-pretty`, a version mismatch, a worker that
 * will not start — and that throw used to propagate all the way out as the
 * scrape's failure, masquerading as a bank problem.
 *
 * <p>The warning goes through `process.emitWarning` rather than a log line
 * for the obvious reason: the logger is what just failed. Consumers can
 * observe it via `process.on('warning')` or silence it like any other.
 *
 * <p>Exported only so the unit test can pin the degradation contract by
 * handing it a transport that cannot resolve.
 * @param logFile - Resolved log file path, used to choose the fallback.
 * @param options - Preferred options, produced by {@link buildPinoOptions}.
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns A usable logger — the preferred one, or a degraded one.
 */
export function instantiateLogger(
  logFile: string,
  options: pino.LoggerOptions,
  env: IEnvironment = activeEnvironment(),
): Logger {
  const built = tryPino(options);
  if (!isErrorLike(built)) return built;
  warnTransportFailure(built, logFile, env);
  return degradeLogger(logFile, env);
}

/**
 * Build file-only fallback Pino options for `fd`.
 * @param fd - Owned `pipeline.log` file descriptor.
 * @returns File-only active Pino options.
 */
function buildFallbackFd(fd: number): pino.LoggerOptions {
  return buildFdOptions(fd, false);
}

/**
 * Build the terminal-only / silent root logger when no trace file is active.
 * @returns Unleased root logger result.
 */
function buildTerminalInstance(): ILeasedLoggerResult {
  const transport = buildTransport('');
  const options = buildPinoOptions(transport);
  return { logger: instantiateLogger('', options), lease: false };
}

/**
 * Build the root logger and optional file lease for `logFile`.
 * @param logFile - Resolved log file path (`''` for terminal-only / silent).
 * @returns Root logger and its owned file lease (when file-backed).
 */
function buildRootInstance(logFile: string): ILeasedLoggerResult {
  if (!logFile) return buildTerminalInstance();
  return instantiateLeasedFileLogger({
    logFile,
    buildPreferredOptions: buildPreferredFd,
    buildFallbackOptions: buildFallbackFd,
    /**
     * Emit the transport degradation warning for `logFile`.
     * @param error - Underlying open or transport construction failure.
     * @returns Always true.
     */
    onTransportFailure: (error: Error): boolean => warnTransportFailure(error, logFile),
    buildSilentFallback: silentLogger,
  });
}

/**
 * Expose the active destination's file-descriptor lease for unit-test cleanup assertions.
 * @internal
 * @returns Active file lease when file-backed, else `false`.
 */
export function getActiveRootFileLeaseForTest(): IFileLease | false {
  const logFile = getLogFile();
  return leaseFor(logFile);
}

/**
 * The root logger for the caller's destination, built on first use.
 *
 * <p>One logger per resolved destination: inside an execution that is the
 * execution's own `pipeline.log`, outside every execution it is the ambient one.
 * The cache is keyed on the destination rather than gated on it, so off-trace
 * runs — where `getLogFile()` returns `''` — hold one terminal-only logger
 * instead of rebuilding a pino instance (and, with `PRETTY_LOGS`, a worker) on
 * every property access. A destination is retired by the run that owns it, or,
 * ambiently, when the process moves to a new run folder.
 * @returns Root pino instance.
 */
export function getRootLogger(): Logger {
  const logFile = getLogFile();
  const scope = currentRunScope();
  if (scope) noteRunLogFile(scope.trace, logFile);
  const slotKey = terminalSlotKey(logFile);
  const slot = slotFor({ logFile, slotKey, isScoped: scope !== false, build: buildRootInstance });
  return slot.logger;
}

/**
 * Terminal-only loggers are shared by destination; include the settings that
 * change their shape so two runs with different pretty/level values do not
 * reuse one logger.
 * @param logFile - Resolved destination.
 * @returns A setting-sensitive slot key for the terminal destination.
 */
function terminalSlotKey(logFile: string): string {
  if (logFile.length > 0) return logFile;
  const env = activeEnvironment();
  return `terminal|${String(env.prettyLogs)}|${env.logLevel}`;
}

/**
 * Current generation of the caller's destination. Child proxies memoise against
 * this so a cached child is dropped exactly when the logger it came from is replaced.
 * @returns Changes exactly when this destination's root logger is rebuilt.
 */
export function getRootLoggerGeneration(): RootLoggerGeneration {
  const logFile = getLogFile();
  const slotKey = terminalSlotKey(logFile);
  return generationFor(slotKey) as RootLoggerGeneration;
}

/**
 * End the running execution's logging: close its trace so a late callback cannot
 * reopen the run's files, then retire only the destination that run recorded.
 * The destination is read from the run, not re-resolved, so this runs in the
 * executor's `finally` without touching the file system or depending on whether
 * capture is still switched on.
 * @returns True when the run owned a file destination that was retired.
 */
export function retireRunLogger(): DidRetireRunLogger {
  const scope = currentRunScope();
  closeActiveRunTrace();
  const logFile = scope === false ? false : scope.trace.logFile;
  return retireRunSlot(logFile) as DidRetireRunLogger;
}
