/**
 * Lazy-built root pino instance + transport selection for the pipeline.
 *
 * The root logger is rebuilt the first time any module reads from it via
 * a {@link ./ChildLoggerProxy.ts | child proxy}; that "deferred-resolve"
 * shape lets pipeline code capture a `LOG` constant at module-load
 * without resolving the file destination too early — file transport
 * only resolves after `executePipeline` has called `setActiveBank`.
 *
 * Extracted from the legacy `Types/Debug.ts` blob during
 * Phase 12c.
 */

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { SENSITIVE_PATHS } from '../Types/DebugConfig.js';
import { createCensorFn } from '../Types/PiiRedactor.js';
import { getLogFile } from '../Types/TraceConfig.js';
import { getBankMixin } from './BankContext.js';

/** Brand for the root-logger generation counter (Rule #15). */
type RootLoggerGeneration = Brand<number, 'RootLoggerGeneration'>;

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

/** Pino transport for dev mode (pretty printing). */
const DEV_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

/** Single source of truth censor — built from PiiRedactor strategies. */
const CENSOR = createCensorFn();

/** Pino's redact options type — pulled from the library so the censor cast
 *  doesn't need to spell `unknown` literally (the codebase forbids that). */
type PinoRedactOptions = NonNullable<pino.LoggerOptions['redact']>;
/** Type of the `censor` field accepted by pino's redact configuration. */
type PinoCensorFn = Extract<PinoRedactOptions, { censor?: unknown }>['censor'];

/**
 * Build a single file-only transport (used in production runs once
 * `setActiveBank` has resolved a real destination).
 * @param logFile - Resolved log file path.
 * @returns Pino file-transport config.
 */
function buildFileTransport(logFile: string): pino.TransportSingleOptions {
  return { target: 'pino/file', options: { destination: logFile } };
}

/**
 * Build the dual terminal-+-file transport used in dev mode so the
 * developer sees pretty output AND the same trace artefact lands on
 * disk for post-run inspection.
 * @param logFile - Resolved log file path.
 * @returns Pino multi-target transport config.
 */
function buildDualTransport(logFile: string): pino.TransportMultiOptions {
  return {
    targets: [
      { target: 'pino-pretty', options: { colorize: true }, level: 'trace' },
      { target: 'pino/file', options: { destination: logFile }, level: 'trace' },
    ],
  };
}

/**
 * Build pino transport — terminal only or terminal + file.
 * @param logFile - Resolved log file path (empty string disables file output).
 * @returns Transport config or false.
 */
function buildTransport(
  logFile: string,
): pino.TransportSingleOptions | pino.TransportMultiOptions | false {
  if (!isDevMode && !logFile) return false;
  if (!logFile) return DEV_TRANSPORT;
  if (!isDevMode) return buildFileTransport(logFile);
  return buildDualTransport(logFile);
}

/** Cached root pino instance — built lazily on first log call so file
 *  destination is resolved AFTER setActiveBank has fired in the orchestrator. */
let rootLoggerCache: Logger | false = false;

/** The `getLogFile()` value {@link rootLoggerCache} was built for. `false`
 *  means "never built"; `''` is a legitimate key — it is the terminal-only
 *  logger used off-trace and before `setActiveBank` fires. Keying on the
 *  destination is what lets the cache hold in the `''` case while still
 *  rebuilding once (and only once) when a real file path appears. */
let rootLoggerKey: string | false = false;

/** Incremented on every root rebuild so child proxies can invalidate their
 *  memoised children without holding a reference to the superseded root. */
let rootGeneration = 0;

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
 * `setActiveBank` resolves a real log file. Closes CR PR #337 finding 2.
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
 * Replace the cached root logger with one bound to `logFile`, flushing the
 * superseded instance so buffered pre-upgrade records still reach their
 * destination.
 *
 * The superseded logger is flushed but deliberately NOT closed. Closing it
 * would terminate its `thread-stream` worker, and writes can still legally
 * arrive on it: `LOG.child({...})` returns a *real* pino child rather than a
 * proxy, so any sub-logger captured before the upgrade keeps writing to the
 * old stream forever and would start throwing on a closed one. Flushing
 * therefore trades a bounded leak for safety — and the bound is small: a run
 * changes destination exactly once (`'' -> <file>`, when `setActiveBank`
 * fires), so at most one logger is ever superseded, and in production
 * (`NODE_ENV=production` with no file) the superseded logger is transportless
 * and owns no worker at all.
 * @param logFile - Resolved log file path (empty string for terminal-only).
 * @returns The freshly built root logger.
 */
function rebuildRootLogger(logFile: string): Logger {
  const previous = rootLoggerCache;
  const transport = buildTransport(logFile);
  const options = buildPinoOptions(transport);
  rootLoggerCache = pino(options);
  rootLoggerKey = logFile;
  rootGeneration += 1;
  if (previous) previous.flush();
  return rootLoggerCache;
}

/**
 * Build (or return cached) root logger. Deferred so getLogFile() runs
 * after `executePipeline` has registered the active bank — only then can
 * TraceConfig produce a real `<RUNS_ROOT>/pipeline/<bank>/<stamp>/pipeline.log`
 * destination.
 *
 * The cache is keyed on the resolved destination rather than gated on it.
 * Gating meant that off-trace runs — where `getLogFile()` returns `''`
 * permanently — cached nothing and rebuilt a pino instance on *every*
 * property access. In dev mode each rebuild started a `pino-pretty`
 * `thread-stream` worker that nothing ever closed: one `LOG.info(...)`
 * costs 23 property reads (pino reads its internal symbols off `this`),
 * so a single log statement leaked 23 worker threads and ~92 MB of
 * `SharedArrayBuffer`. Keying preserves the file-upgrade behaviour the
 * gate was reaching for while holding a single logger for the current
 * destination.
 *
 * This is a one-entry cache, so an `A -> B -> A` destination sequence
 * rebuilds `A`. That is acceptable: the only transition a real run makes
 * is `'' -> <file>`, once, when `setActiveBank` fires. Logging
 * configuration read at construction time (notably `LOG_LEVEL`) is
 * therefore start-up only for a given destination.
 * @returns Root pino instance.
 */
export function getRootLogger(): Logger {
  const logFile = getLogFile();
  if (rootLoggerCache && rootLoggerKey === logFile) return rootLoggerCache;
  return rebuildRootLogger(logFile);
}

/**
 * Current root-logger generation. Child proxies memoise against this so a
 * cached child is dropped exactly when the root it came from is replaced.
 * @returns Monotonic counter, incremented on every root rebuild.
 */
export function getRootLoggerGeneration(): RootLoggerGeneration {
  return rootGeneration as RootLoggerGeneration;
}
