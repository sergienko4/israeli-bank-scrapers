/** Pipeline executor — reduces over phases; short-circuits on failure. */

import type {
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../../Base/Interface.js';
import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import { runWithBankContext } from '../../Logging/Debug.js';
import { retireRunLogger } from '../../Logging/RootLogger.js';
import { type IEnvironment, readEnvironment } from '../../Types/Environment.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isKnownBankSlug } from '../../Types/TraceConfig.js';
import buildInitialContext from '../PipelineContextFactory.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import toResult from '../PipelineResult.js';
import reportCleanupFailure from './CleanupDiagnostic.js';
import { failedPhase, type IContextTracker, reducePhases, wrapError } from './PipelineReducer.js';

/** Largest delay the platform timer accepts, in milliseconds. */
const MAX_TIMER_MS = 2_147_483_647;

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
 * Convert a phase throw, preferring the abort verdict when the run was cancelled.
 * @param error - The caught value.
 * @returns The abort failure or the wrapped error.
 */
function caughtPhaseFailure(error: unknown): Procedure<IPipelineContext> {
  const failure = wrapError(error as Error);
  return failedPhase(failure);
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
    return caughtPhaseFailure(error);
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
 * Run a synchronous initializer, retiring the run's logger when it throws.
 * Context construction can log (and thus open the run's file logger) before
 * failing; `runWithCleanup` never starts, so the executor must retire it.
 * @param build - Initializer to run inside the open scope.
 * @returns The initializer's result.
 */
function retireLoggerOnThrow<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    retireRunLogger();
    throw error;
  }
}

/**
 * Build and register the initial context, retiring the run logger on failure.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns The registered initial context.
 */
function buildReadyContext(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): IPipelineContext {
  /**
   * Build the unregistered initial context.
   * @returns The initial context.
   */
  const build = (): IPipelineContext => buildInitialContext(descriptor, credentials);
  const initialCtx = retireLoggerOnThrow(build);
  registerOrFail(initialCtx);
  return initialCtx;
}

/**
 * Build the context and run phase reduction inside the execution's scope.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns Pipeline result Procedure.
 */
function runInsideScope(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<Procedure<IPipelineContext>> {
  const initialCtx = buildReadyContext(descriptor, credentials);
  const tracker: IContextTracker = { phases: descriptor.phases, lastCtx: initialCtx };
  return runWithCleanup(tracker, initialCtx);
}

/**
 * The deadline signal, when the caller named a usable positive deadline.
 * @param deadlineMs - Whole-run deadline in milliseconds.
 * @returns One signal to combine, or none for an absent or unusable value.
 */
function deadlineSignals(deadlineMs?: number): AbortSignal[] {
  if (deadlineMs === undefined) return [];
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return [];
  const wholeMs = Math.floor(deadlineMs);
  const ms = Math.min(wholeMs, MAX_TIMER_MS);
  return [AbortSignal.timeout(ms)];
}

/**
 * Combine the caller's signal with the run deadline into one run signal.
 * @param options - Public scraper options.
 * @returns The combined signal, or false when the caller named neither.
 */
function runAbortSignal(options: ScraperOptions): AbortSignal | false {
  const signals = [...deadlineSignals(options.deadlineMs)];
  if (options.signal !== undefined) signals.push(options.signal);
  if (signals.length === 0) return false;
  return AbortSignal.any(signals);
}

/**
 * Run phase reduction + cleanup inside the bank's async-local log context.
 * The context is built inside the scope so environment-dependent construction
 * (logger, PII policy, client certificate) sees this execution's snapshot.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @param env - Environment snapshot for this execution.
 * @returns Pipeline result Procedure.
 */
function runInBankContext(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
  env: IEnvironment,
): Promise<Procedure<IPipelineContext>> {
  /**
   * Build the context and reduce phases inside the scope.
   * @returns Pipeline result Procedure.
   */
  const run = (): Promise<Procedure<IPipelineContext>> => runInsideScope(descriptor, credentials);
  const signal = runAbortSignal(descriptor.options);
  return runWithBankContext(descriptor.options.companyId, run, { env, signal });
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
 * @param env - Environment snapshot; defaults to the process boundary.
 * @returns Legacy result shape.
 */
async function executePipeline(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
  env: IEnvironment = readEnvironment(),
): Promise<IScraperScrapingResult> {
  return toResult(await runInBankContext(descriptor, credentials, env));
}

export default executePipeline;
