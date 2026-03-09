import type { Logger } from 'pino';

import type { IScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { ILoginContext, INamedLoginStep, IStepResult, LoginStep } from './LoginMiddleware.js';
import { runLoginChain } from './LoginMiddleware.js';

/** Position metadata for a step in the login chain. */
interface IStepPosition {
  readonly index: number;
  readonly total: number;
  readonly name: string;
}

/**
 * Build a log tag showing step position in the chain.
 * @param pos - The step position metadata.
 * @returns A formatted tag like '[1/5] navigate'.
 */
function tag(pos: IStepPosition): string {
  const stepNumber = String(pos.index + 1);
  const totalSteps = String(pos.total);
  return `[${stepNumber}/${totalSteps}] ${pos.name}`;
}

/**
 * Format a successful step completion message.
 * @param pos - The step position metadata.
 * @param ms - The elapsed milliseconds.
 * @returns A formatted success message.
 */
function formatDone(pos: IStepPosition, ms: number): string {
  const msStr = String(ms);
  return `${tag(pos)} \u2713 (${msStr}ms)`;
}

/**
 * Format a step-stopped message with the error type.
 * @param pos - The step position metadata.
 * @param result - The step result that stopped the chain.
 * @returns A formatted stop message.
 */
function formatStopped(pos: IStepPosition, result: IStepResult): string {
  const errorType = result.result?.errorType ?? 'stopped';
  return `${tag(pos)} \u2717 ${errorType}`;
}

/**
 * Log trace-level context for a step (URL, frame count).
 * @param logger - The pino logger instance.
 * @param pos - The step position metadata.
 * @param ctx - The login context.
 * @returns True after logging.
 */
function logTraceContext(logger: Logger, pos: IStepPosition, ctx: ILoginContext): boolean {
  const frameCount = ctx.parsedPage?.childFrames.length ?? 0;
  const pageUrl = ctx.page.url();
  const stepTag = tag(pos);
  logger.trace('%s: url=%s, frames=%d', stepTag, pageUrl, frameCount);
  return true;
}

/**
 * Wrap a login step with logging instrumentation.
 * @param step - The named login step to wrap.
 * @param logger - The pino logger instance.
 * @param pos - The step position metadata.
 * @returns A wrapped LoginStep function with logging.
 */
function wrapStep(step: INamedLoginStep, logger: Logger, pos: IStepPosition): LoginStep {
  return async (ctx: ILoginContext): Promise<IStepResult> => {
    logTraceContext(logger, pos, ctx);
    const startMs = Date.now();
    const result = await step.execute(ctx);
    const ms = Date.now() - startMs;
    const msg = result.shouldContinue ? formatDone(pos, ms) : formatStopped(pos, result);
    logger.info(msg);
    return result;
  };
}

/**
 * Log the chain plan showing all step names in order.
 * @param steps - The array of named login steps.
 * @param logger - The pino logger instance.
 * @returns True after logging.
 */
function logChainPlan(steps: INamedLoginStep[], logger: Logger): boolean {
  const plan = steps.map(stepItem => stepItem.name).join(' \u2192 ');
  logger.info('chain: %s', plan);
  return true;
}

/** Nullable scraping result — null means all steps continued without stopping. */
type NullableScrapingResult = Promise<IScraperScrapingResult | null>;

/**
 * Run the login chain with per-step logging instrumentation.
 * @param steps - The array of named login steps.
 * @param ctx - The login context shared across steps.
 * @param logger - The pino logger instance.
 * @returns The scraping result from the first stopping step, or null.
 */
export async function runLoggedChain(
  steps: INamedLoginStep[],
  ctx: ILoginContext,
  logger: Logger,
): NullableScrapingResult {
  logChainPlan(steps, logger);
  const total = steps.length;
  const wrapped = steps.map((stepItem, index) =>
    wrapStep(stepItem, logger, { index, total, name: stepItem.name }),
  );
  return runLoginChain(wrapped, ctx);
}

export type { INamedLoginStep } from './LoginMiddleware.js';
