/**
 * Resolution trace — logs full IRaceResult at trace level.
 * Pass-through: returns the same result for chaining.
 * Called after every resolveVisible/resolveField/resolveAndClick.
 */

import type { Frame, Page } from 'playwright-core';

import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IRaceResult } from './ElementMediator.js';

/** Prefix map: Page has 'context' property, Frame does not. */
const CTX_PREFIX: Record<string, string> = { true: 'main', false: 'iframe' };

/**
 * Describe a Page or Frame context for trace logging.
 * @param ctx - Playwright Page or Frame, or false.
 * @returns Human-readable context description.
 */
function describeContext(ctx: Page | Frame | false): string {
  if (!ctx) return 'none';
  const url = ctx.url();
  const isMain = 'context' in ctx;
  const prefix = CTX_PREFIX[String(isMain)];
  const maxLen = 60;
  const isLong = url.length > maxLen;
  const truncMap: Record<string, string> = { true: `${url.slice(0, 57)}...`, false: url };
  const short = truncMap[String(isLong)];
  return `${prefix}:${short}`;
}

/** Winner metadata from resolution race. */
interface IWinnerMeta {
  readonly kind: string;
  readonly value: string;
}

/** Trace payload emitted to the logger for a single resolution. */
interface ITracePayload {
  readonly resolution: string;
  readonly found: boolean;
  readonly winner: IWinnerMeta | false;
  readonly context: string;
  readonly index: number;
  readonly snapshot: string;
}

/**
 * Build winner metadata from race result candidate.
 * @param result - Race result.
 * @returns Winner object or false.
 */
function buildWinner(result: IRaceResult): IWinnerMeta | false {
  if (!result.candidate) return false;
  return { kind: result.candidate.kind, value: maskVisibleText(result.candidate.value) };
}

/**
 * Build the trace payload from a label + race result (pure, no I/O).
 * @param label - Resolution label.
 * @param result - The full race result from resolveVisible.
 * @returns Frozen trace payload.
 */
function buildTracePayload(label: string, result: IRaceResult): ITracePayload {
  return {
    resolution: label,
    found: result.found,
    winner: buildWinner(result),
    context: describeContext(result.context),
    index: result.index,
    snapshot: maskVisibleText(result.value),
  };
}

/**
 * Log full IRaceResult at trace level — zero behavior change.
 * @param logger - Pipeline logger.
 * @param label - Resolution label (e.g. "HOME.PRE entry", "OTP.PRE mfa").
 * @param result - The full race result from resolveVisible.
 * @returns The same result (pass-through for chaining).
 */
function traceResolution(logger: ScraperLogger, label: string, result: IRaceResult): IRaceResult {
  const payload = buildTracePayload(label, result);
  logger.trace(payload);
  return result;
}

export default traceResolution;
export { traceResolution };
