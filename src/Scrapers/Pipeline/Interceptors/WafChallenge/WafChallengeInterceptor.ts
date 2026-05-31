/**
 * WafChallengeInterceptor — generic background WAF checkbox-challenge
 * resolver.
 *
 * <p><b>What it solves</b>: When an Israeli bank's WAF (Imperva / Cloudflare)
 * interleaves a hCaptcha or Turnstile checkbox challenge into the navigation
 * flow, the scraper can no longer reach the login form. Manual solve is not
 * an option for headless / CI. This interceptor watches every browser-flow
 * pipeline run in the background and clicks the checkbox via Camoufox's
 * documented C++-humanize auto-pass primitive.
 *
 * <p><b>Bank-agnostic, phase-agnostic by contract</b>: attached once at the
 * first `beforePhase` call after the browser is launched and then polls
 * autonomously on a {@link WAF_POLL_INTERVAL_MS} timer. Scrapers never
 * await it — page interactions either succeed (challenge cleared in time)
 * or retry, by which point the solver has cleared the gate.
 *
 * <p><b>Closure-based factory</b>: each `createWafChallengeInterceptor()`
 * call returns a fresh instance with its own per-page state — matches
 * the PopupInterceptor pattern. Safe for parallel scraper runs.
 *
 * <p><b>Disable switch</b>: set `WAF_INTERCEPTOR_DISABLED=1` (or `true`)
 * to bypass the interceptor for bisecting / local debugging.
 *
 * <p>Internals are split into {@link "./WafChallengeInternals.js"} to keep
 * both files under the Pipeline 150-line file cap.
 */

import type { IPipelineInterceptor } from '../../Types/Interceptor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import {
  type IInterceptorState,
  makeState,
  runAfterPipeline,
  runBeforePhase,
} from './WafChallengeInternals.js';

/**
 * Wrap a synchronous value into a resolved Promise. Matches the pattern
 * used by sibling interceptors (NetworkTraceLifecycle, Snapshot, Mock)
 * to keep closures non-async while still returning the Promise shape
 * that {@link IPipelineInterceptor} requires.
 * @param value - Value to wrap.
 * @returns A resolved Promise with the value.
 */
function wrapAsync<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

/**
 * Build the beforePhase handler closure. Emits a trace event with the
 * upcoming phase name (satisfies `no-unused-vars` for nextPhase and
 * adds useful diagnostics) before delegating to runBeforePhase.
 * @param state - Per-instance interceptor state.
 * @returns Async beforePhase handler matching IPipelineInterceptor.
 */
function buildBeforePhase(
  state: IInterceptorState,
): (ctx: IPipelineContext, nextPhase: string) => Promise<Procedure<IPipelineContext>> {
  return (ctx: IPipelineContext, nextPhase: string): Promise<Procedure<IPipelineContext>> => {
    ctx.logger.trace({ event: 'waf.beforePhase', phase: nextPhase });
    const result = runBeforePhase(ctx, state);
    return wrapAsync(result);
  };
}

/**
 * Build the afterPipeline handler closure.
 * @param state - Per-instance interceptor state.
 * @returns Async afterPipeline handler matching IPipelineInterceptor.
 */
function buildAfterPipeline(
  state: IInterceptorState,
): (ctx: IPipelineContext) => Promise<Procedure<boolean>> {
  return (ctx: IPipelineContext): Promise<Procedure<boolean>> => {
    const result = runAfterPipeline(ctx, state);
    return wrapAsync(result);
  };
}

/**
 * Create a WafChallengeInterceptor with per-instance state.
 * @returns IPipelineInterceptor that auto-solves checkbox WAF challenges.
 */
function createWafChallengeInterceptor(): IPipelineInterceptor {
  const state = makeState();
  const beforePhase = buildBeforePhase(state);
  const afterPipeline = buildAfterPipeline(state);
  return { name: 'waf-challenge', beforePhase, afterPipeline };
}

export default createWafChallengeInterceptor;
export { buildAfterPipeline, buildBeforePhase, createWafChallengeInterceptor, wrapAsync };
