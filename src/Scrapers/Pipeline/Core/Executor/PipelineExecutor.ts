/** Pipeline executor — reduces over phases; short-circuits on failure. */

import type { IScraperScrapingResult, ScraperCredentials } from '../../../Base/Interface.js';
import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { setActiveBank } from '../../Types/TraceConfig.js';
import { buildInitialContext } from '../PipelineContextFactory.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import { toResult } from '../PipelineResult.js';
import runAfterPipeline from './PipelineFinalizer.js';
import {
  assembleInterceptors,
  ensureBrowserCleanup,
  type IContextTracker,
} from './PipelineMiddleware.js';
import { reducePhases, wrapError } from './PipelineReducer.js';

/**
 * Awaits an optional dispose() callback, swallowing any thrown error so the
 * already-failing scrape outcome is never masked.
 * @param disposeFn - Optional dispose hook (undefined for mediators with no
 * owned resources).
 * @returns Resolves once dispose has been attempted (success or swallowed).
 */
async function tryDispose(disposeFn?: () => Promise<void>): LifecyclePromise {
  try {
    await disposeFn?.();
  } catch {
    /* silent: dispose must never mask the original scrape outcome */
  }
}

/**
 * Disposes an apiMediator that owns external resources (e.g. a Camoufox
 * browser). Mediators without an own resource (dispose === undefined) are
 * a no-op.
 * @param ctx - The last-known pipeline context carrying the mediator slot.
 * @returns Resolves once dispose has been attempted (success or swallowed).
 */
async function disposeApiMediatorSafe(ctx: IPipelineContext): LifecyclePromise {
  if (ctx.apiMediator.has) await tryDispose(ctx.apiMediator.value.dispose);
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
    return wrapError(error);
  } finally {
    await runAfterPipeline(tracker.interceptors, tracker.lastCtx);
    await ensureBrowserCleanup(tracker, initialCtx.logger);
    await disposeApiMediatorSafe(tracker.lastCtx);
  }
}

/**
 * Execute a pipeline descriptor against credentials.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns Legacy result shape.
 */
/**
 * Register the active bank or fail loudly. There is no run without a bank.
 * @param ctx - Initial pipeline context carrying companyId.
 * @returns True after successful registration (throws otherwise).
 */
function registerOrFail(ctx: IPipelineContext): true {
  const wasRegistered = setActiveBank(ctx.companyId);
  if (wasRegistered) return true;
  const slug = ctx.companyId;
  const reason = `companyId="${slug}" is not a known TraceConfig slug`;
  throw new ScraperError(`[PipelineExecutor] No run without bank — ${reason}.`);
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
  registerOrFail(initialCtx);
  const interceptors = assembleInterceptors(descriptor.interceptors);
  const tracker: IContextTracker = {
    phases: descriptor.phases,
    interceptors,
    lastCtx: initialCtx,
  };
  return toResult(await runWithCleanup(tracker, initialCtx));
}

export { executePipeline };
export default executePipeline;
