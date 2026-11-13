/** Pipeline executor — reduces over phases; short-circuits on failure. */

import type { IScraperScrapingResult, ScraperCredentials } from '../../../Base/Interface.js';
import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import { runWithBankContext } from '../../Logging/Debug.js';
import { retireRunLogger } from '../../Logging/RootLogger.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isKnownBankSlug } from '../../Types/TraceConfig.js';
import { buildInitialContext } from '../PipelineContextFactory.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import { toResult } from '../PipelineResult.js';
import { reportCleanupFailure } from './CleanupDiagnostic.js';
import { type IContextTracker, reducePhases, wrapError } from './PipelineReducer.js';

/**
 * Awaits an optional dispose() callback. A failure never masks the already
 * produced scrape outcome and never escapes; it is reported once, allowlisted,
 * through the execution's own logger.
 * @param ctx - The last-known pipeline context carrying the mediator slot.
 * @param disposeFn - Optional dispose hook (undefined for mediators with no
 * owned resources).
 * @returns Resolves once dispose has been attempted (success or reported).
 */
async function tryDispose(
  ctx: IPipelineContext,
  disposeFn?: () => Promise<void>,
): LifecyclePromise {
  try {
    await disposeFn?.();
  } catch (error) {
    reportCleanupFailure(ctx, error);
  }
}

/**
 * Disposes an apiMediator that owns external resources (e.g. a pooled
 * connection). Mediators without an own resource (dispose === undefined) are
 * a no-op.
 * @param ctx - The last-known pipeline context carrying the mediator slot.
 * @returns Resolves once dispose has been attempted (success or reported).
 */
async function disposeApiMediatorSafe(ctx: IPipelineContext): LifecyclePromise {
  if (ctx.apiMediator.has) await tryDispose(ctx, ctx.apiMediator.value.dispose);
}

/**
 * Run phase reduction and convert any unexpected throw into a Procedure failure.
 * @param tracker - Context tracker.
 * @param initialCtx - Initial pipeline context.
 * @returns Phase reduction Procedure.
 */
async function runGuardedPhases(
  tracker: IContextTracker,
  initialCtx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  try {
    return await reducePhases(tracker, initialCtx, 0);
  } catch (error) {
    return wrapError(error as Error);
  }
}

/**
 * End one execution: dispose its mediator, then retire only the log destination
 * that execution owned. The order matters, since disposal still logs.
 * @param ctx - The last-known pipeline context.
 * @returns Resolves once both steps have been attempted.
 */
async function finishRun(ctx: IPipelineContext): LifecyclePromise {
  await disposeApiMediatorSafe(ctx);
  retireRunLogger();
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
    return await runGuardedPhases(tracker, initialCtx);
  } finally {
    await finishRun(tracker.lastCtx);
  }
}

/**
 * Build the zero-arg cleanup thunk passed to {@link runWithBankContext}.
 * @param tracker - Context tracker.
 * @param initialCtx - Initial pipeline context.
 * @returns Thunk invoking {@link runWithCleanup}.
 */
function makeCleanupThunk(
  tracker: IContextTracker,
  initialCtx: IPipelineContext,
): () => Promise<Procedure<IPipelineContext>> {
  return (): Promise<Procedure<IPipelineContext>> => runWithCleanup(tracker, initialCtx);
}

/**
 * Run phase reduction + cleanup inside the bank's async-local log context.
 * @param tracker - Context tracker.
 * @param initialCtx - Initial pipeline context carrying companyId.
 * @returns Pipeline result Procedure.
 */
function runInBankContext(
  tracker: IContextTracker,
  initialCtx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const run = makeCleanupThunk(tracker, initialCtx);
  return runWithBankContext(initialCtx.companyId, run);
}

/**
 * Validate the bank or fail loudly. There is no run without a bank. The run's
 * own scope carries the bank from here on, so nothing process-global is set.
 * @param ctx - Initial pipeline context carrying companyId.
 * @returns True when the bank is known (throws otherwise).
 */
function registerOrFail(ctx: IPipelineContext): true {
  const isKnown = isKnownBankSlug(ctx.companyId);
  if (isKnown) return true;
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
  const tracker: IContextTracker = { phases: descriptor.phases, lastCtx: initialCtx };
  return toResult(await runInBankContext(tracker, initialCtx));
}

export { executePipeline };
export default executePipeline;
