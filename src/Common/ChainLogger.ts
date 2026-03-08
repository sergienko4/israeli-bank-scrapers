import type { Logger } from 'pino';

import type { ScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { LoginContext, LoginStep, NamedLoginStep, StepResult } from './LoginMiddleware.js';
import { runLoginChain } from './LoginMiddleware.js';

interface StepPosition {
  readonly index: number;
  readonly total: number;
  readonly name: string;
}

function tag(pos: StepPosition): string {
  return `[${pos.index + 1}/${pos.total}] ${pos.name}`;
}

function formatDone(pos: StepPosition, ms: number): string {
  return `${tag(pos)} \u2713 (${ms}ms)`;
}

function formatStopped(pos: StepPosition, result: StepResult): string {
  const errorType = result.result?.errorType ?? 'stopped';
  return `${tag(pos)} \u2717 ${errorType}`;
}

function logTraceContext(logger: Logger, pos: StepPosition, ctx: LoginContext): void {
  const frameCount = ctx.parsedPage?.childFrames.length ?? 0;
  logger.trace('%s: url=%s, frames=%d', tag(pos), ctx.page.url(), frameCount);
}

function wrapStep(step: NamedLoginStep, logger: Logger, pos: StepPosition): LoginStep {
  return async (ctx: LoginContext): Promise<StepResult> => {
    logTraceContext(logger, pos, ctx);
    const startMs = Date.now();
    const result = await step.execute(ctx);
    const ms = Date.now() - startMs;
    const msg = result.shouldContinue ? formatDone(pos, ms) : formatStopped(pos, result);
    logger.info(msg);
    return result;
  };
}

function logChainPlan(steps: NamedLoginStep[], logger: Logger): void {
  const plan = steps.map(s => s.name).join(' \u2192 ');
  logger.info('chain: %s', plan);
}

export async function runLoggedChain(
  steps: NamedLoginStep[],
  ctx: LoginContext,
  logger: Logger,
): Promise<ScraperScrapingResult | null> {
  logChainPlan(steps, logger);
  const total = steps.length;
  const wrapped = steps.map((s, i) => wrapStep(s, logger, { index: i, total, name: s.name }));
  return runLoginChain(wrapped, ctx);
}

export type { NamedLoginStep } from './LoginMiddleware.js';
