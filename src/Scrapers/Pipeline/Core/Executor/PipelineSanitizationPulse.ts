/**
 * Sanitization Pulse — re-run interceptors and retry a failed phase.
 * Generic recovery: PopupInterceptor can dismiss late-appearing overlays.
 * Extracted from PipelineExecutor to respect max-lines.
 */

import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { isOk } from '../../Types/Procedure.js';
import { traceResult } from '../PipelineTraceService.js';
import { applyInterceptors, type IContextTracker } from './PipelineMiddleware.js';

/** Phase index tag for trace logging (e.g. "2/8"). */
type PhaseIndexTag = string;
/** Zero-based phase position in the pipeline. */
type PhasePosition = number;

/** Bundled phase step context for tracing. */
interface IPhaseStep {
  readonly name: PhaseName;
  readonly tag: PhaseIndexTag;
  readonly index: PhasePosition;
}

/** Bundled retry context for sanitization pulse. */
interface IPulseArgs {
  readonly tracker: IContextTracker;
  readonly ctx: IPipelineContext;
  readonly step: IPhaseStep;
}

/**
 * Prime ActiveState before phase retry.
 * @param name - Phase name.
 * @param logger - Pipeline logger.
 * @returns True after priming.
 */
function primeRetry(name: PhaseName, logger: IPipelineContext['logger']): true {
  setActivePhase(name);
  setActiveStage('PRE');
  logger.debug({ message: `retry: ${name}` });
  return true;
}

/**
 * Sanitization Pulse: re-run interceptors then retry failed phase once.
 * @param args - Bundled pulse arguments.
 * @returns Recovered context or false if retry also failed.
 */
async function sanitizationPulse(args: IPulseArgs): Promise<IPipelineContext | false> {
  const { tracker, ctx, step } = args;
  ctx.logger.debug({ message: `sanitization-pulse: ${step.name}` });
  const pulsed = await applyInterceptors(tracker, ctx, step.name);
  if (!isOk(pulsed)) return false;
  primeRetry(step.name, ctx.logger);
  const retry = await tracker.phases[step.index].run(pulsed.value);
  if (!isOk(retry)) return false;
  traceResult({ logger: ctx.logger, name: step.name, indexTag: step.tag, isSuccess: true });
  return retry.value;
}

export type { IPhaseStep };
export { sanitizationPulse };
