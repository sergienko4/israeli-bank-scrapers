/**
 * Pipeline executor — reduces over phases, short-circuits on failure.
 * Each phase runs: pre -> action -> post -> final via BasePhase.run().
 */

import { ScraperErrorTypes } from '../Base/ErrorTypes.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../Base/Interface.js';
import { runAllCleanups } from './Phases/Terminate/TerminatePhase.js';
import { buildInitialContext } from './PipelineContextFactory.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { toResult } from './PipelineResult.js';
import type { BasePhase } from './Types/BasePhase.js';
import { toErrorMessage } from './Types/ErrorUtils.js';
import type { IPipelineInterceptor } from './Types/Interceptor.js';
import type { IBrowserState, IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';
import { fail, isOk, succeed } from './Types/Procedure.js';

/** Mutable state for phase reduction. */
interface IContextTracker {
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
  lastCtx: IPipelineContext;
}

/**
 * Extract browser cleanup handlers from a pipeline context.
 * @param ctx - The pipeline context.
 * @returns Cleanup functions, or empty array if no browser.
 */
function extractCleanups(ctx: IPipelineContext): IBrowserState['cleanups'] {
  if (!ctx.browser.has) return [];
  return ctx.browser.value.cleanups;
}

/**
 * Run browser cleanup from the tracked context.
 * @param tracker - Context tracker with the last known context.
 * @param logger - Logger for error reporting.
 * @returns Count of successful cleanups.
 */
async function ensureBrowserCleanup(
  tracker: IContextTracker,
  logger: IPipelineContext['logger'],
): Promise<number> {
  const cleanups = extractCleanups(tracker.lastCtx);
  if (cleanups.length === 0) return 0;
  logger.debug('emergency cleanup: %d', cleanups.length);
  return await runAllCleanups(cleanups, logger);
}

/**
 * Run interceptors sequentially before a phase starts.
 * @param interceptors - Ordered list of interceptors.
 * @param ctx - Current pipeline context.
 * @param index - Current interceptor index.
 * @returns Updated context or first failure.
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
 * Run interceptors if browser is available.
 * @param tracker - Context tracker with interceptors.
 * @param ctx - Current pipeline context.
 * @returns Updated context after interceptors.
 */
async function applyInterceptors(
  tracker: IContextTracker,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has) return succeed(ctx);
  if (tracker.interceptors.length === 0) return succeed(ctx);
  return await runInterceptors(tracker.interceptors, ctx, 0);
}

/**
 * Reduce phases sequentially, tracking latest context.
 * @param tracker - Mutable tracker with phases and interceptors.
 * @param ctx - Current pipeline context.
 * @param index - Current phase index.
 * @returns Final Procedure with accumulated context.
 */
async function reducePhases(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= tracker.phases.length) return succeed(ctx);
  const intercepted = await applyInterceptors(tracker, ctx);
  if (!isOk(intercepted)) return intercepted;
  tracker.lastCtx = intercepted.value;
  const result = await tracker.phases[index].run(intercepted.value);
  if (!isOk(result)) return result;
  return reducePhases(tracker, result.value, index + 1);
}

/**
 * Wrap an error into an IProcedureFailure.
 * @param error - The caught error.
 * @returns A failure Procedure with Generic error type.
 */
function wrapError(error: Error): Procedure<IPipelineContext> {
  const message = toErrorMessage(error) || 'Unknown pipeline error';
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Run the phase reduction with cleanup guarantee.
 * @param tracker - Context tracker.
 * @param initialCtx - Initial pipeline context.
 * @returns Pipeline result Procedure.
 */
async function runWithCleanup(
  tracker: IContextTracker,
  initialCtx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  try {
    return await reducePhases(tracker, initialCtx, 0);
  } catch (error) {
    return wrapError(error as Error);
  } finally {
    await ensureBrowserCleanup(tracker, initialCtx.logger);
  }
}

/**
 * Execute a pipeline descriptor against credentials.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns Legacy result shape for backward compatibility.
 */
async function executePipeline(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const initialCtx = buildInitialContext(descriptor, credentials);
  const tracker: IContextTracker = {
    phases: descriptor.phases,
    interceptors: descriptor.interceptors,
    lastCtx: initialCtx,
  };
  const result = await runWithCleanup(tracker, initialCtx);
  return toResult(result);
}

export default executePipeline;
export { executePipeline };
