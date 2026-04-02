/**
 * Pipeline executor — reduces over phases, short-circuits on failure.
 * Interceptors and cleanup in PipelineMiddleware.ts.
 * Phase tracing in PipelineTraceService.ts.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Base/Interface.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import { buildInitialContext } from './PipelineContextFactory.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import {
  applyInterceptors,
  ensureBrowserCleanup,
  type IContextTracker,
} from './PipelineMiddleware.js';
import { toResult } from './PipelineResult.js';
import { buildPhaseTag, traceResult, traceStart } from './PipelineTraceService.js';

/**
 * Run one phase with interceptors.
 * @param tracker - Context tracker.
 * @param ctx - Current context.
 * @param index - Phase index.
 * @returns Phase result Procedure.
 */
async function runPhase(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  const intercepted = await applyInterceptors(tracker, ctx);
  if (!isOk(intercepted)) return intercepted;
  tracker.lastCtx = intercepted.value;
  return tracker.phases[index].run(intercepted.value);
}

/**
 * Reduce phases sequentially with trace.
 * @param tracker - Context tracker.
 * @param ctx - Current context.
 * @param index - Current phase index.
 * @returns Final accumulated context.
 */
async function reducePhases(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= tracker.phases.length) return succeed(ctx);
  const phase = tracker.phases[index];
  const tag = buildPhaseTag(index, tracker.phases.length, phase.name);
  traceStart(tag);
  const result = await runPhase(tracker, ctx, index);
  const isSuccess = isOk(result);
  traceResult(tag, isSuccess);
  if (!isSuccess) return result;
  return reducePhases(tracker, result.value, index + 1);
}

/**
 * Wrap error into failure Procedure.
 * @param error - The caught error.
 * @returns Generic failure Procedure.
 */
function wrapError(error: Error): Procedure<IPipelineContext> {
  const message = toErrorMessage(error) || 'Unknown pipeline error';
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Run phase reduction with cleanup guarantee.
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
 * @returns Legacy result shape.
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
