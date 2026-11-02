/**
 * Beinleumi log capture — the Debug module a log suite mocks in: every
 * pipeline logger becomes one real pino logger at `trace`, with the
 * production redaction config, whose serialized lines land in
 * {@link LOG_LINES}. A suite registers it before importing any pipeline module:
 * `jest.unstable_mockModule('<path>/Logging/Debug.js', capturingDebugModule)`.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { PassThrough } from 'node:stream';

import pino, { type Logger, type LoggerOptions } from 'pino';

// The logger modules are imported statically, never inside the factory: the
// factory runs while the module graph is still linking, and a dynamic import of
// RootLogger's PiiRedactor graph from there races that link on Node 22.
import {
  getActiveLogContext,
  runWithBankContext,
} from '../../../Scrapers/Pipeline/Logging/BankContext.js';
import { buildSilentOptions } from '../../../Scrapers/Pipeline/Logging/RootLogger.js';

/** Every serialized log line any pipeline module emitted. */
export const LOG_LINES: string[] = [];

/** The Debug module, every logger the capturing one. */
interface ICapturingDebug {
  readonly getActiveLogContext: typeof getActiveLogContext;
  readonly runWithBankContext: typeof runWithBankContext;
  readonly getDebug: () => Logger;
  readonly getDebugByName: () => Logger;
}

/**
 * Note one serialized line.
 * @param chunk - The line pino wrote.
 * @returns The number of lines noted.
 */
function noteLine(chunk: Buffer): number {
  const line = chunk.toString();
  return LOG_LINES.push(line);
}

/**
 * Real pino logger at `trace`, production redaction, deterministic output.
 * @param production - Production pino options (redaction + mixin).
 * @returns Logger whose lines land in {@link LOG_LINES}.
 */
function makeCapturingLogger(production: LoggerOptions): Logger {
  const stream = new PassThrough();
  stream.on('data', noteLine);
  const options = { ...production, level: 'trace', timestamp: false, base: undefined };
  return pino(options, stream);
}

/**
 * The Debug module factory: every pipeline module shares the capturing logger.
 * @returns The mocked Debug module.
 */
export function capturingDebugModule(): ICapturingDebug {
  const production = buildSilentOptions();
  const logger = makeCapturingLogger(production);
  /**
   * The capturing logger, whatever the module asks for.
   * @returns The capturing logger.
   */
  const getDebug = (): Logger => logger;
  return { getActiveLogContext, runWithBankContext, getDebug, getDebugByName: getDebug };
}
