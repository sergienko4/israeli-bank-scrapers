/**
 * Pipeline middleware — interceptors and cleanup for phase execution.
 * Extracted from PipelineExecutor to respect 150-line Core/ limit.
 */

import { runAllCleanups } from '../Phases/Terminate/TerminatePhase.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IBrowserState, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { isOk, succeed } from '../Types/Procedure.js';

/** Mutable state for phase reduction. */
export interface IContextTracker {
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
  lastCtx: IPipelineContext;
}

/**
 * Extract browser cleanups from context.
 * @param ctx - Pipeline context with optional browser.
 * @returns Cleanup functions array.
 */
function extractCleanups(ctx: IPipelineContext): IBrowserState['cleanups'] {
  if (!ctx.browser.has) return [];
  return ctx.browser.value.cleanups;
}

/**
 * Run browser cleanup from tracked context.
 * @param tracker - Context tracker with last known state.
 * @param logger - Logger for error reporting.
 * @returns Count of successful cleanups.
 */
export async function ensureBrowserCleanup(
  tracker: IContextTracker,
  logger: IPipelineContext['logger'],
): Promise<number> {
  const cleanups = extractCleanups(tracker.lastCtx);
  if (cleanups.length === 0) return 0;
  return await runAllCleanups(cleanups, logger);
}

/**
 * Run interceptors sequentially.
 * @param interceptors - Ordered interceptor list.
 * @param ctx - Current pipeline context.
 * @param index - Current interceptor index.
 * @returns Updated context or failure.
 */
async function runInterceptors(
  interceptors: readonly IPipelineInterceptor[],
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= interceptors.length) return succeed(ctx);
  const result = await interceptors[index].beforePhase(ctx);
  if (!isOk(result)) return result;
  return await runInterceptors(interceptors, result.value, index + 1);
}

/**
 * Apply interceptors if browser available.
 * @param tracker - Context tracker with interceptors.
 * @param ctx - Current pipeline context.
 * @returns Updated context after interceptors.
 */
export async function applyInterceptors(
  tracker: IContextTracker,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has) return succeed(ctx);
  if (tracker.interceptors.length === 0) return succeed(ctx);
  return await runInterceptors(tracker.interceptors, ctx, 0);
}
