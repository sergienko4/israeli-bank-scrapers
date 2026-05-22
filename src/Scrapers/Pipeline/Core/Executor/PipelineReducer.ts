/** Pipeline phase reducer — split from PipelineExecutor to keep files under 150 lines. */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { PHASE_SETTLE_MS } from '../../Mediator/Timing/TimingConfig.js';
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
const NO_RETRY_PHASES: ReadonlySet<string> = new Set(['api-direct-call', 'api-direct-scrape']);

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
 * Phase settle — give the bank's SPA a fixed window to settle
 * (analytics, deferred hydration, cross-origin pixels) and to give
 * the page's anti-bot JS time to observe a "human-paused-on-page"
 * interval before our next interaction. Fired TWICE per phase: once
 * before phase.PRE work begins (`when='pre'`), once after phase.FINAL
 * completes (`when='final'`). FINAL settle is skipped for the
 * terminal phase so pipeline completion is not delayed.
 *
 * @param ctx - Active pipeline context (used for structured trace).
 * @param step - The phase step entering or just-finished.
 * @param when - 'pre' (before phase work) or 'final' (after phase work).
 * @returns True after the settle resolves.
 */
async function phaseSettle(
  ctx: IPipelineContext,
  step: IPhaseStep,
  when: 'pre' | 'final',
): Promise<true> {
  ctx.logger.debug({
    phase: step.name,
    event: 'phase-settle',
    when,
    elapsedMs: String(PHASE_SETTLE_MS),
  });
  await setTimeoutPromise(PHASE_SETTLE_MS, undefined, { ref: false });
  return true as const;
}

/**
 * Trace success and continue to next phase. The FINAL-side phase
 * settle is invoked from reducePhases (one call site) so the wait
 * does NOT run on sanitization-pulse retry paths.
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
 * Apply the FINAL-side phase settle (skipped on terminal phase) then
 * continue to the next phase via traceAndContinue. Extracted from
 * reducePhases to respect the 15-line ceiling + 1-level nesting rule.
 * @param tracker - Context tracker.
 * @param ctx - Recovered/successful context.
 * @param step - Phase step metadata (carries phase index + total).
 * @returns Next phase reduction.
 */
async function settleAndContinue(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  step: IPhaseStep,
): Promise<Procedure<IPipelineContext>> {
  const hasNext = step.index + 1 < tracker.phases.length;
  if (hasNext) await phaseSettle(ctx, step, 'final');
  return traceAndContinue(tracker, ctx, step);
}

/**
 * Reduce phases sequentially with trace + sanitization pulse on failure.
 * Bracketed by `phaseSettle` at PRE and FINAL: 4 s settle BEFORE
 * each phase's PRE work begins (so the bank's anti-bot JS sees a
 * "human paused on the page" interval before we touch anything) and
 * 4 s AFTER each phase's FINAL work succeeds (so the page can
 * complete post-action settle before the next phase's PRE settle).
 * Terminal-phase FINAL settle is skipped to avoid delaying exit;
 * sanitization-pulse retries skip BOTH settles to avoid double-penalty.
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
  await phaseSettle(ctx, step, 'pre');
  const result = await runPhase(tracker, ctx, index);
  if (isOk(result)) return settleAndContinue(tracker, result.value, step);
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
