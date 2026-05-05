/** Pipeline phase reducer — split from PipelineExecutor to keep files under 150 lines. */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { buildPhaseIndex, traceResult, traceStart } from '../PipelineTraceService.js';
import type { IContextTracker } from './PipelineMiddleware.js';
import { type IPhaseStep, sanitizationPulse } from './PipelineSanitizationPulse.js';

/**
 * Phases that MUST NOT be retried by the sanitization pulse because
 * re-running them has real-world side-effects (e.g. api-direct-call
 * fires a fresh SMS OTP on every retry). Browser phases can be safely
 * retried; API-only phases cannot.
 */
const NO_RETRY_PHASES: ReadonlySet<string> = new Set(['api-direct-call']);

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
  const { applyInterceptors } = await import('./PipelineMiddleware.js');
  const nextPhase = tracker.phases[index].name;
  const intercepted = await applyInterceptors(tracker, ctx, nextPhase);
  if (!isOk(intercepted)) return intercepted;
  tracker.lastCtx = intercepted.value;
  return tracker.phases[index].run(intercepted.value);
}

/**
 * Prime ActiveState and emit trace START before phase executes.
 * @param name - Phase name.
 * @param indexTag - Phase index tag.
 * @param logger - Pipeline logger.
 * @returns True after priming.
 */
function primePhaseState(name: string, indexTag: string, logger: IPipelineContext['logger']): true {
  setActivePhase(name);
  setActiveStage('PRE');
  traceStart(logger, name, indexTag);
  return true;
}

/**
 * Build phase step metadata for tracing.
 * @param tracker - Context tracker.
 * @param index - Phase index.
 * @returns Phase step metadata.
 */
function buildStep(tracker: IContextTracker, index: number): IPhaseStep {
  const name = tracker.phases[index].name;
  const tag = buildPhaseIndex(index, tracker.phases.length);
  return { name, tag, index };
}

/**
 * Trace success and continue to next phase.
 * @param tracker - Context tracker.
 * @param ctx - Successful context.
 * @param step - Phase step metadata.
 * @returns Next phase reduction.
 */
function traceAndContinue(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  step: IPhaseStep,
): Promise<Procedure<IPipelineContext>> {
  traceResult({ logger: ctx.logger, name: step.name, indexTag: step.tag, isSuccess: true });
  return reducePhases(tracker, ctx, step.index + 1);
}

/** Args bundle for handlePhaseFailure (keeps parameter count within budget). */
interface IFailureArgs {
  readonly tracker: IContextTracker;
  readonly ctx: IPipelineContext;
  readonly step: IPhaseStep;
  readonly result: Procedure<IPipelineContext>;
}

/**
 * Handle phase failure: respect NO_RETRY list or attempt sanitization pulse.
 * @param args - Tracker + ctx + step + failed result bundle.
 * @returns Either recovered continuation or original failure.
 */
async function handlePhaseFailure(args: IFailureArgs): Promise<Procedure<IPipelineContext>> {
  const { tracker, ctx, step, result } = args;
  if (NO_RETRY_PHASES.has(step.name)) {
    traceResult({ logger: ctx.logger, name: step.name, indexTag: step.tag, isSuccess: false });
    return result;
  }
  const recovered = await sanitizationPulse({ tracker, ctx, step });
  if (recovered !== false) return traceAndContinue(tracker, recovered, step);
  traceResult({ logger: ctx.logger, name: step.name, indexTag: step.tag, isSuccess: false });
  return result;
}

/**
 * Reduce phases sequentially with trace + sanitization pulse on failure.
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
  const step = buildStep(tracker, index);
  primePhaseState(step.name, step.tag, ctx.logger);
  const result = await runPhase(tracker, ctx, index);
  if (isOk(result)) return traceAndContinue(tracker, result.value, step);
  return handlePhaseFailure({ tracker, ctx, step, result });
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

export { reducePhases, wrapError };
export default reducePhases;
