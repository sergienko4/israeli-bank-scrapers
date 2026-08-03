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

/** Bundled phase step context for tracing. */
interface IPhaseStep {
  readonly name: PhaseName;
  readonly tag: string;
  readonly index: number;
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
 * How many recovery pulses one failed phase may consume.
 *
 * <p>Two, because clearing an obstruction and making progress past it are
 * separate steps. Max stacks a consent bar and a marketing modal: the first
 * pulse clears the modal that swallowed HOME's trigger click, and only the
 * second sees the menu that click finally opened. One pulse leaves the phase
 * one move short of the login link.
 */
const MAX_PULSES = 2;

/**
 * Run interceptors once, then retry the failed phase once.
 * @param args - Bundled pulse arguments.
 * @returns Recovered context, or false when this attempt did not recover.
 */
async function pulseOnce(args: IPulseArgs): Promise<IPipelineContext | false> {
  const { tracker, ctx, step } = args;
  ctx.logger.debug({ message: `sanitization-pulse: ${step.name}` });
  const pulsed = await applyInterceptors(tracker, ctx, step.name);
  if (!isOk(pulsed)) return false;
  primeRetry(step.name, ctx.logger);
  const retry = await tracker.phases[step.index].run(pulsed.value);
  return isOk(retry) ? retry.value : false;
}

/**
 * Pulse until the phase recovers or the budget runs out.
 * @param args - Bundled pulse arguments.
 * @param left - Pulses still available.
 * @returns Recovered context, or false when every pulse failed.
 */
async function pulseFrom(args: IPulseArgs, left: number): Promise<IPipelineContext | false> {
  if (left <= 0) return false;
  const recovered = await pulseOnce(args);
  if (recovered !== false) return recovered;
  return pulseFrom(args, left - 1);
}

/**
 * Sanitization Pulse: re-run interceptors then retry the failed phase, up to
 * {@link MAX_PULSES} times.
 * @param args - Bundled pulse arguments.
 * @returns Recovered context or false if every retry also failed.
 */
async function sanitizationPulse(args: IPulseArgs): Promise<IPipelineContext | false> {
  const recovered = await pulseFrom(args, MAX_PULSES);
  if (recovered === false) return false;
  const { logger } = args.ctx;
  traceResult({ logger, name: args.step.name, indexTag: args.step.tag, isSuccess: true });
  return recovered;
}

export type { IPhaseStep };
export { sanitizationPulse };
