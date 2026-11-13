/** Pipeline phase reducer — runs phases in order and short-circuits on the first failure. */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { BasePhase } from '../../Phases/Base/BasePhase.js';
import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type PhaseName from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { buildPhaseIndex, traceResult, traceStart } from '../PipelineTraceService.js';

/** Mutable state for phase reduction. */
export interface IContextTracker {
  readonly phases: readonly BasePhase[];
  lastCtx: IPipelineContext;
}

/** Phase step metadata for tracing. */
interface IPhaseStep {
  readonly name: PhaseName;
  readonly tag: string;
  readonly index: number;
}

/**
 * Run one phase and, when it succeeds, remember the context it produced so the
 * executor disposes whatever the final phase installed. A phase that throws
 * leaves the last good context in place.
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
  const result = await tracker.phases[index].run(ctx);
  if (isOk(result)) tracker.lastCtx = result.value;
  return result;
}

/**
 * Prime ActiveState and emit trace START before phase executes.
 * @param step - Phase step metadata.
 * @param logger - Pipeline logger.
 * @returns True after priming.
 */
function primePhaseState(step: IPhaseStep, logger: IPipelineContext['logger']): true {
  setActivePhase(step.name);
  setActiveStage('PRE');
  traceStart(logger, step.name, step.tag);
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
 * Trace the phase outcome and forward the phase result unchanged.
 * @param ctx - Context carrying the logger.
 * @param step - Phase step metadata.
 * @param result - Result returned by the phase.
 * @returns The same phase result Procedure.
 */
function traceOutcome(
  ctx: IPipelineContext,
  step: IPhaseStep,
  result: Procedure<IPipelineContext>,
): Procedure<IPipelineContext> {
  const isSuccess = isOk(result);
  traceResult({ logger: ctx.logger, name: step.name, indexTag: step.tag, isSuccess });
  return result;
}

/**
 * Prime state, run one phase and emit its outcome trace.
 * @param tracker - Context tracker.
 * @param ctx - Current context.
 * @param index - Current phase index.
 * @returns Phase result Procedure.
 */
async function executeTracedPhase(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  const step = buildStep(tracker, index);
  primePhaseState(step, ctx.logger);
  const result = await runPhase(tracker, ctx, index);
  return traceOutcome(ctx, step, result);
}

/**
 * Reduce phases sequentially with trace. A failed phase is returned as-is:
 * both phases have real-world side effects (api-direct-call sends a fresh
 * SMS OTP), so none is ever re-run.
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
  const result = await executeTracedPhase(tracker, ctx, index);
  if (!isOk(result)) return result;
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

export { reducePhases, wrapError };
export default reducePhases;
