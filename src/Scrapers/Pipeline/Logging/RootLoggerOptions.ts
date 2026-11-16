/**
 * Root-logger option and transport selection. Split from `RootLogger.ts` so
 * the lifecycle/lease half stays under the file cap, and so the environment
 * boundary supplies the pretty/level choices without a `process.env` read.
 */

import type { LoggerOptions, TransportMultiOptions, TransportSingleOptions } from 'pino';

import SENSITIVE_PATHS from '../Types/DebugConfig.js';
import { activeEnvironment, type IEnvironment } from '../Types/Environment.js';
import { createCensorFn } from '../Types/PiiRedactor.js';
import { getBankMixin } from './BankContext.js';

/** Pino transport for pretty printing. */
const PRETTY_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

/** Single source of truth censor — built from PiiRedactor strategies. */
const CENSOR = createCensorFn();

/** Pino's redact options type. */
type PinoRedactOptions = NonNullable<LoggerOptions['redact']>;

/** Type of the `censor` field accepted by pino's redact configuration. */
type PinoCensorFn = Extract<PinoRedactOptions, { censor?: unknown }>['censor'];

/**
 * Build a single file-only transport.
 * @param destination - Resolved log file path or owned file descriptor.
 * @returns Pino file-transport config.
 */
function buildFileTransport(destination: string | number): TransportSingleOptions {
  return { target: 'pino/file', options: { destination } };
}

/**
 * Build the dual terminal-+-file transport used when pretty output is
 * requested.
 * @param destination - Resolved log file path or owned file descriptor.
 * @returns Pino multi-target transport config.
 */
function buildDualTransport(destination: string | number): TransportMultiOptions {
  return {
    targets: [
      { ...PRETTY_TRANSPORT, level: 'trace' },
      { target: 'pino/file', options: { destination }, level: 'trace' },
    ],
  };
}

/**
 * Build pino transport — terminal only, file only, both, or none.
 * @param logFile - Resolved log file path (empty string disables file output).
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns Transport config or false.
 */
export function buildTransport(
  logFile: string,
  env: IEnvironment = activeEnvironment(),
): TransportSingleOptions | TransportMultiOptions | false {
  const isPretty = env.prettyLogs;
  if (!isPretty && !logFile) return false;
  if (!logFile) return PRETTY_TRANSPORT;
  if (!isPretty) return buildFileTransport(logFile);
  return buildDualTransport(logFile);
}

/**
 * Build the pino redact config from the single-source-of-truth censor.
 * @returns Pino redact options.
 */
function buildRedact(): NonNullable<LoggerOptions['redact']> {
  return { paths: SENSITIVE_PATHS, censor: CENSOR as unknown as PinoCensorFn };
}

/**
 * Common pino-options fields shared between the silent and active branches.
 * @returns Pino options fields that never depend on the transport choice.
 */
function buildCommonOptions(): Pick<LoggerOptions, 'redact' | 'mixin'> {
  return { redact: buildRedact(), mixin: getBankMixin };
}

/**
 * Compose pino options for the explicit "no transport configured" case.
 * @returns Pino options producing a fully silent logger.
 */
export function buildSilentOptions(): LoggerOptions {
  return { level: 'silent', ...buildCommonOptions() };
}

/**
 * Compose pino options around a real transport.
 * @param transport - Non-false transport produced by {@link buildTransport}.
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns Pino logger options ready for `pino(...)`.
 */
function buildActiveOptions(
  transport: LoggerOptions['transport'],
  env: IEnvironment = activeEnvironment(),
): LoggerOptions {
  return { level: env.logLevel, transport, ...buildCommonOptions() };
}

/**
 * Compose pino constructor options around a resolved transport.
 * @param transport - Transport produced by {@link buildTransport}.
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns Pino logger options ready for `pino(...)`.
 */
export function buildPinoOptions(
  transport: LoggerOptions['transport'] | false,
  env: IEnvironment = activeEnvironment(),
): LoggerOptions {
  return transport === false ? buildSilentOptions() : buildActiveOptions(transport, env);
}

/**
 * The options {@link buildTransport} would have produced without pretty output.
 * @param logFile - Resolved log file path (empty string for no file output).
 * @returns Pino options with the pretty target dropped.
 */
export function optionsWithoutPretty(logFile: string): LoggerOptions {
  if (!logFile) return buildSilentOptions();
  const transport = buildFileTransport(logFile);
  return buildActiveOptions(transport);
}

/**
 * Build active Pino options around an owned file descriptor `fd`.
 * @param fd - Owned `pipeline.log` file descriptor.
 * @param isDual - Whether to include the pretty terminal target alongside `fd`.
 * @returns Active Pino options targeting `fd`.
 */
export function buildFdOptions(fd: number, isDual: boolean): LoggerOptions {
  const transport = isDual ? buildDualTransport(fd) : buildFileTransport(fd);
  return buildActiveOptions(transport);
}

/**
 * Build preferred active Pino options for `fd` honoring `PRETTY_LOGS`.
 * @param fd - Owned `pipeline.log` file descriptor.
 * @returns Preferred active Pino options.
 */
export function buildPreferredFd(fd: number): LoggerOptions {
  const isPretty = activeEnvironment().prettyLogs;
  return buildFdOptions(fd, isPretty);
}
