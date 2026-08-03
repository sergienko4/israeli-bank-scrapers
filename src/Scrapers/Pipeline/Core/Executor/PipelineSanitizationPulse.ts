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
 * Phases granted a SECOND recovery pulse.
 *
 * <p>Clearing an obstruction and making progress past it are separate steps.
 * Max stacks a consent bar and a marketing modal: the first pulse clears the
 * modal that swallowed HOME's trigger click, and only the second sees the menu
 * that click finally opened. One pulse leaves the phase one move short.
 *
 * <p>Deliberately narrow — every other phase keeps its single retry, so the
 * pipeline-wide recovery contract is unchanged.
 */
const TWO_PULSE_PHASES: ReadonlySet<PhaseName> = new Set<PhaseName>(['home']);

/**
 * Recovery pulses a failed phase may consume.
 * @param name - Phase that failed.
 * @returns Pulse budget for that phase.
 */
function pulseBudget(name: PhaseName): number {
  return TWO_PULSE_PHASES.has(name) ? 2 : 1;
}

/**
 * Run interceptors once, then retry the failed phase once.
 * @param args - Bundled pulse arguments.
 * @param attempt - 1-based pulse number, surfaced in the log so a trace shows
 *   which pulse cleared the obstruction and how many were consumed.
 * @returns Recovered context, or false when this attempt did not recover.
 */
async function pulseOnce(args: IPulseArgs, attempt: number): Promise<IPipelineContext | false> {
  const { tracker, ctx, step } = args;
  const budget = pulseBudget(step.name);
  const nth = `${String(attempt)}/${String(budget)}`;
  ctx.logger.debug({ message: `sanitization-pulse: ${step.name} (${nth})` });
  const pulsed = await applyInterceptors(tracker, ctx, step.name);
  if (!isOk(pulsed)) return false;
  primeRetry(step.name, ctx.logger);
  const retry = await tracker.phases[step.index].run(pulsed.value);
  return isOk(retry) ? retry.value : false;
}

/**
 * Pulse until the phase recovers or the budget runs out.
 * @param args - Bundled pulse arguments.
 * @param attempt - 1-based pulse number to run next.
 * @returns Recovered context, or false when every pulse failed.
 */
async function pulseFrom(args: IPulseArgs, attempt: number): Promise<IPipelineContext | false> {
  if (attempt > pulseBudget(args.step.name)) return false;
  const recovered = await pulseOnce(args, attempt);
  if (recovered !== false) return recovered;
  return pulseFrom(args, attempt + 1);
}

/**
 * Sanitization Pulse: re-run interceptors then retry the failed phase, within
 * the phase's {@link pulseBudget}.
 * @param args - Bundled pulse arguments.
 * @returns Recovered context or false if every retry also failed.
 */
async function sanitizationPulse(args: IPulseArgs): Promise<IPipelineContext | false> {
  const recovered = await pulseFrom(args, 1);
  if (recovered === false) return false;
  const { logger } = args.ctx;
  traceResult({ logger, name: args.step.name, indexTag: args.step.tag, isSuccess: true });
  return recovered;
}

export type { IPhaseStep };
export { sanitizationPulse };
