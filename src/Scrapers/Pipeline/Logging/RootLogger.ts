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
import { SENSITIVE_PATHS } from '../Types/DebugConfig.js';
import { toError } from '../Types/ErrorUtils.js';
import { createCensorFn } from '../Types/PiiRedactor.js';
import { currentRunScope, noteRunLogFile } from '../Types/RunScope.js';
import { closeActiveRunTrace, getLogFile } from '../Types/TraceConfig.js';
import { getBankMixin } from './BankContext.js';
import {
  type IFileLease,
  type ILeasedLoggerResult,
  instantiateLeasedFileLogger,
} from './FileLease.js';
import { generationFor, leaseFor, retireRunSlot, slotFor } from './LoggerSlots.js';

/** Whether a finished run owned a file destination that was retired (Rule #15). */
type DidRetireRunLogger = Brand<boolean, 'DidRetireRunLogger'>;

/** Brand for the root-logger generation counter (Rule #15). */
type RootLoggerGeneration = Brand<number, 'RootLoggerGeneration'>;

/** Opt-in flag for human-readable terminal output. */
const PRETTY_LOGS_ENV = 'PRETTY_LOGS';

/** Pino transport for pretty printing. */
const PRETTY_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

/** Prefix of the out-of-band warning emitted when pretty output is unusable. */
const PRETTY_UNAVAILABLE =
  `${PRETTY_LOGS_ENV} was requested but the transport could not be built; ` +
  'continuing without it:';

/** Prefix used when the failing transport is not the pretty one. */
const TRANSPORT_UNAVAILABLE = 'log transport could not be built; continuing without it:';

/** Prefix used when even the degraded transport fails and logging goes silent. */
const FALLBACK_UNAVAILABLE = 'degraded log transport could not be built either; going silent:';

/**
 * True iff `PRETTY_LOGS=true` (case-insensitive, whitespace-trimmed).
 *
 * <p>Default-deny, and read per call rather than captured at module load so
 * the choice is testable and so a consumer can set it before their first log.
 *
 * <p>This replaces a check on `CI` and `NODE_ENV`. That check was inverted
 * in practice: it treated "the caller set neither variable" as "we are
 * developing this library", which is the ordinary state of any application
 * that depends on it. Every such consumer was handed a `pino-pretty`
 * transport — a devDependency absent from their production install — and the
 * scrape died resolving it before reaching the network (issue #552). Pretty
 * output is a developer convenience, so it is now asked for explicitly.
 * @returns True only when the flag is the literal `true`.
 */
function isPrettyLogs(): boolean {
  const flag = (process.env[PRETTY_LOGS_ENV] ?? '').trim().toLowerCase();
  return flag === 'true';
}

/** Single source of truth censor — built from PiiRedactor strategies. */
const CENSOR = createCensorFn();

/** Pino's redact options type — pulled from the library so the censor cast
 *  doesn't need to spell `unknown` literally (the codebase forbids that). */
type PinoRedactOptions = NonNullable<pino.LoggerOptions['redact']>;
/** Type of the `censor` field accepted by pino's redact configuration. */
type PinoCensorFn = Extract<PinoRedactOptions, { censor?: unknown }>['censor'];

/**
 * Build a single file-only transport (used in production runs once
 * the execution's scope has resolved a real destination).
 * @param destination - Resolved log file path or owned file descriptor.
 * @returns Pino file-transport config.
 */
function buildFileTransport(destination: string | number): pino.TransportSingleOptions {
  return { target: 'pino/file', options: { destination } };
}

/**
 * Build the dual terminal-+-file transport used when pretty output is
 * requested, so the developer sees pretty output AND the same trace
 * artefact lands on disk for post-run inspection.
 * @param destination - Resolved log file path or owned file descriptor.
 * @returns Pino multi-target transport config.
 */
function buildDualTransport(destination: string | number): pino.TransportMultiOptions {
  return {
    targets: [
      { ...PRETTY_TRANSPORT, level: 'trace' },
      { target: 'pino/file', options: { destination }, level: 'trace' },
    ],
  };
}

/**
 * Build pino transport — terminal only, file only, both, or none.
 *
 * <p>Exported only so the unit test can pin the selection contract without
 * bootstrapping a real pino instance.
 * @param logFile - Resolved log file path (empty string disables file output).
 * @returns Transport config or false.
 */
export function buildTransport(
  logFile: string,
): pino.TransportSingleOptions | pino.TransportMultiOptions | false {
  const isPretty = isPrettyLogs();
  if (!isPretty && !logFile) return false;
  if (!logFile) return PRETTY_TRANSPORT;
  if (!isPretty) return buildFileTransport(logFile);
  return buildDualTransport(logFile);
}

/**
 * Build the pino redact config from the single-source-of-truth censor.
 * @returns Pino redact options.
 */
function buildRedact(): NonNullable<pino.LoggerOptions['redact']> {
  return { paths: SENSITIVE_PATHS, censor: CENSOR as unknown as PinoCensorFn };
}

/**
 * Common pino-options fields shared between the silent and active branches
 * of {@link buildPinoOptions}. Extracted so adding a new pino option in the
 * future updates both branches atomically.
 * @returns Pino options fields that never depend on the transport choice.
 */
function buildCommonOptions(): Pick<pino.LoggerOptions, 'redact' | 'mixin'> {
  return { redact: buildRedact(), mixin: getBankMixin };
}

/**
 * Compose pino options for the explicit "no transport configured" case.
 * Sets `level: 'silent'` instead of omitting the transport field — without
 * this branch pino v10 falls back to its default destination (STDOUT),
 * emitting unintended log noise in CI / production runs that fire before
 * the execution's scope resolves a real log file. Closes CR PR #337 finding 2.
 *
 * Exported only so the unit test can pin the silent-level contract without
 * having to mutate `process.env.CI` mid-test.
 * @returns Pino options producing a fully silent logger.
 */
export function buildSilentOptions(): pino.LoggerOptions {
  return { level: 'silent', ...buildCommonOptions() };
}

/**
 * Compose pino options around a real transport — honours `LOG_LEVEL` env
 * override so operators can crank verbosity at runtime.
 *
 * Exported only so the unit test can pin the env-driven level + transport
 * pass-through contract without bootstrapping a real pino instance.
 * @param transport - Non-false transport produced by {@link buildTransport}.
 * @returns Pino logger options ready for `pino(...)`.
 */
export function buildActiveOptions(transport: pino.LoggerOptions['transport']): pino.LoggerOptions {
  return { level: process.env.LOG_LEVEL ?? 'info', transport, ...buildCommonOptions() };
}

/**
 * Compose pino constructor options around a resolved transport. Dispatches
 * to {@link buildSilentOptions} when {@link buildTransport} returned `false`
 * (explicit "disabled" signal) or {@link buildActiveOptions} otherwise.
 *
 * Exported only so the unit test can pin the dispatch contract.
 * @param transport - Transport produced by {@link buildTransport}.
 * @returns Pino logger options ready for `pino(...)`.
 */
export function buildPinoOptions(
  transport: pino.LoggerOptions['transport'] | false,
): pino.LoggerOptions {
  return transport === false ? buildSilentOptions() : buildActiveOptions(transport);
}

/**
 * The options {@link buildTransport} would have produced had pretty output
 * not been requested — one step down, never two: a run that asked for a
 * trace file keeps it.
 * @param logFile - Resolved log file path (empty string for no file output).
 * @returns Pino options with the pretty target dropped.
 */
function optionsWithoutPretty(logFile: string): pino.LoggerOptions {
  if (!logFile) return buildSilentOptions();
  const transport = buildFileTransport(logFile);
  return buildActiveOptions(transport);
}

/**
 * Emit the degradation warning naming the transport that actually failed.
 * Blaming `PRETTY_LOGS` for a trace-file failure would send whoever reads
 * the warning after a flag they never set, so the flag is named only when
 * pretty output was the sole target and therefore the only candidate.
 * @param error - The failure thrown while constructing the transport.
 * @param logFile - Resolved log file path; a non-empty one means a second
 * target was present, so the failure is not attributable to pretty output.
 * @returns True once the warning has been emitted.
 */
function warnTransportFailure(error: Error, logFile: string): true {
  const isPrettyOnly = isPrettyLogs() && !logFile;
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
 * Build the degraded logger, and if even that cannot be constructed fall
 * back to a transportless silent instance.
 * @param logFile - Resolved log file path, used to choose the fallback.
 * @returns A usable logger — the degraded one, or a silent one.
 */
function degradeLogger(logFile: string): Logger {
  const fallback = optionsWithoutPretty(logFile);
  try {
    return pino(fallback);
  } catch (error_) {
    const error = toError(error_);
    return silentLogger(error);
  }
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
 * @returns A usable logger — the preferred one, or a degraded one.
 */
export function instantiateLogger(logFile: string, options: pino.LoggerOptions): Logger {
  try {
    return pino(options);
  } catch (error_) {
    const error = toError(error_);
    warnTransportFailure(error, logFile);
    return degradeLogger(logFile);
  }
}

/**
 * Build active Pino options around an owned file descriptor `fd`.
 * @param fd - Owned `pipeline.log` file descriptor.
 * @param isDual - Whether to include the pretty terminal target alongside `fd`.
 * @returns Active Pino options targeting `fd`.
 */
function buildFdOptions(fd: number, isDual: boolean): pino.LoggerOptions {
  const transport = isDual ? buildDualTransport(fd) : buildFileTransport(fd);
  return buildActiveOptions(transport);
}

/**
 * Build preferred active Pino options for `fd` honoring `PRETTY_LOGS`.
 * @param fd - Owned `pipeline.log` file descriptor.
 * @returns Preferred active Pino options.
 */
function buildPreferredFd(fd: number): pino.LoggerOptions {
  const isPretty = isPrettyLogs();
  return buildFdOptions(fd, isPretty);
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
  return slotFor({ logFile, isScoped: scope !== false, build: buildRootInstance }).logger;
}

/**
 * Current generation of the caller's destination. Child proxies memoise against
 * this so a cached child is dropped exactly when the logger it came from is replaced.
 * @returns Changes exactly when this destination's root logger is rebuilt.
 */
export function getRootLoggerGeneration(): RootLoggerGeneration {
  const logFile = getLogFile();
  return generationFor(logFile) as RootLoggerGeneration;
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
