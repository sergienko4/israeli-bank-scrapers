/**
 * Lazy-built root pino instance + transport selection for the pipeline.
 *
 * The root logger is rebuilt the first time any module reads from it via
 * a {@link ./ChildLoggerProxy.ts | child proxy}; that "deferred-resolve"
 * shape lets pipeline code capture a `LOG` constant at module-load
 * without resolving the file destination too early — file transport
 * only resolves after `executePipeline` has called `setActiveBank`.
 *
 * Extracted from the legacy {@link ../Types/Debug.ts} blob during
 * Phase 12c.
 */

import pino, { type Logger } from 'pino';

import type { Brand } from '../Types/Brand.js';
import { SENSITIVE_PATHS } from '../Types/DebugConfig.js';
import { createCensorFn } from '../Types/PiiRedactor.js';
import { getLogFile } from '../Types/TraceConfig.js';
import { getBankMixin } from './BankContext.js';

/** Brand for the cached-state predicate (Rule #15). */
type IsRootLoggerCached = Brand<boolean, 'IsRootLoggerCached'>;

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
 * Build (or return cached) root logger. Deferred so getLogFile() runs
 * after `executePipeline` has registered the active bank — only then can
 * TraceConfig produce a real `<RUNS_ROOT>/pipeline/<bank>/<stamp>/pipeline.log`
 * destination.
 * @returns Root pino instance.
 */
export function getRootLogger(): Logger {
  if (rootLoggerCache) return rootLoggerCache;
  const logFile = getLogFile();
  const transport = buildTransport(logFile);
  const options = buildPinoOptions(transport);
  const logger = pino(options);
  if (logFile) rootLoggerCache = logger;
  return logger;
}

/**
 * Read-only accessor for the root-logger cache state. Lets the child-proxy
 * resolver know whether it can store a child logger permanently or must
 * keep rebuilding on every access (pre-`setActiveBank` lifecycle window).
 * @returns True once `setActiveBank` has resolved a real file destination.
 */
export function isRootLoggerCached(): IsRootLoggerCached {
  return (rootLoggerCache !== false) as IsRootLoggerCached;
}
