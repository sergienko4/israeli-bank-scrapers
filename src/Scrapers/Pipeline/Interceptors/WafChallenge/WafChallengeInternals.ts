/**
 * WafChallenge — internal poller/solver primitives shared by the interceptor.
 *
 * <p>Extracted from WafChallengeInterceptor.ts to keep both files under the
 * Pipeline 150-line cap. All exports are package-internal — only the
 * factory in WafChallengeInterceptor.ts is meant to be consumed externally.
 */

import type { Frame, Page } from 'playwright-core';

import type { Brand } from '../../Types/Brand.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import {
  WAF_INTERCEPTOR_DISABLED_ENV,
  WAF_POLL_INTERVAL_MS,
  WAF_SOLVE_COOLDOWN_MS,
} from './WafChallengeConfig.js';
import { detectChallenge } from './WafChallengeDetector.js';
import { getSolver } from './WafChallengeSolverRegistry.js';
import type { DidSolve, WafChallengeKind } from './WafChallengeTypes.js';

type DidTickWork = Brand<boolean, 'DidTickWork'>;
type DidAttach = Brand<boolean, 'DidAttach'>;
type DidDetach = Brand<boolean, 'DidDetach'>;
type IsEnabled = Brand<boolean, 'IsEnabled'>;
type IsInCooldown = Brand<boolean, 'IsInCooldown'>;

/** Per-instance state — closed over by the returned interceptor. */
interface IInterceptorState {
  readonly attached: WeakSet<Page>;
  readonly timers: WeakMap<Page, NodeJS.Timeout>;
  readonly solving: WeakSet<Page>;
  readonly lastSolveAtMs: WeakMap<Page, number>;
}

/** Bundle handed into tick/attach helpers — keeps signatures short. */
interface ITickArgs {
  readonly page: Page;
  readonly logger: ScraperLogger;
  readonly state: IInterceptorState;
}

/** Bundle for solver dispatch. */
interface ISolverDispatchArgs {
  readonly tick: ITickArgs;
  readonly kind: WafChallengeKind;
  readonly frame: Frame;
}

/**
 * Build a fresh per-instance state record.
 * @returns Initial IInterceptorState with empty Weak collections.
 */
export function makeState(): IInterceptorState {
  return {
    attached: new WeakSet<Page>(),
    timers: new WeakMap<Page, NodeJS.Timeout>(),
    solving: new WeakSet<Page>(),
    lastSolveAtMs: new WeakMap<Page, number>(),
  };
}

/**
 * Read the kill-switch env var.
 * @returns IsEnabled(true) when the WAF interceptor is disabled by env.
 */
export function isDisabled(): IsEnabled {
  const raw = process.env[WAF_INTERCEPTOR_DISABLED_ENV] ?? '';
  const isOn = raw === '1' || raw.toLowerCase() === 'true';
  return isOn as IsEnabled;
}

/**
 * Whether `lastSolveAtMs` falls inside the cool-down window.
 * @param state - Per-instance state.
 * @param page - The page being polled.
 * @returns IsInCooldown(true) when the previous solve was within WAF_SOLVE_COOLDOWN_MS.
 */
export function isInCooldown(state: IInterceptorState, page: Page): IsInCooldown {
  const last = state.lastSolveAtMs.get(page) ?? 0;
  const isWithin = Date.now() - last < WAF_SOLVE_COOLDOWN_MS;
  return isWithin as IsInCooldown;
}

/**
 * Safe wrapper over solver() that swallows runtime throws into DidSolve(false).
 * @param args - Solver dispatch bundle.
 * @returns DidSolve outcome from the solver, or false on throw.
 */
export async function runSolverSafe(args: ISolverDispatchArgs): Promise<DidSolve> {
  const solver = getSolver(args.kind);
  const solverArgs = { page: args.tick.page, frame: args.frame };
  const outcome = await solver(solverArgs).catch((): DidSolve => false as DidSolve);
  return outcome;
}

/**
 * Mark page as solving, dispatch the right solver, log the outcome, release
 * the solving flag, and record the cool-down timestamp.
 * @param args - Solver dispatch bundle.
 * @returns DidSolve outcome from the underlying solver.
 */
export async function runSolverGuarded(args: ISolverDispatchArgs): Promise<DidSolve> {
  args.tick.state.solving.add(args.tick.page);
  args.tick.logger.debug({ event: 'waf.solve.start', kind: args.kind });
  const didSolve = await runSolverSafe(args);
  args.tick.logger.debug({ event: 'waf.solve.done', kind: args.kind, didSolve });
  const nowMs = Date.now();
  args.tick.state.lastSolveAtMs.set(args.tick.page, nowMs);
  args.tick.state.solving.delete(args.tick.page);
  return didSolve;
}

/**
 * Run one detect+solve cycle defensively.
 * @param args - Page/logger/state bundle.
 * @returns DidTickWork(true) iff a solve was attempted this tick.
 */
export async function tickOnce(args: ITickArgs): Promise<DidTickWork> {
  if (args.state.solving.has(args.page)) return false as DidTickWork;
  if (isInCooldown(args.state, args.page)) return false as DidTickWork;
  const detected = detectChallenge(args.page);
  if (!detected.has) return false as DidTickWork;
  const dispatch: ISolverDispatchArgs = {
    tick: args,
    kind: detected.value.kind,
    frame: detected.value.frame,
  };
  await runSolverGuarded(dispatch);
  return true as DidTickWork;
}

/**
 * Build the interval handler — wraps async tick in a sync callback for setInterval.
 * @param args - Tick bundle.
 * @returns Synchronous handler safe for setInterval.
 */
export function buildIntervalHandler(args: ITickArgs): () => true {
  return (): true => {
    tickOnce(args).catch((): false => false);
    return true;
  };
}

/**
 * Stop polling and forget the timer handle for a page.
 * @param page - The page whose poller should stop.
 * @param state - Per-instance state.
 * @returns DidDetach(true) iff a timer was actually cleared.
 */
export function detachPoller(page: Page, state: IInterceptorState): DidDetach {
  const timer = state.timers.get(page);
  if (!timer) return false as DidDetach;
  clearInterval(timer);
  state.timers.delete(page);
  return true as DidDetach;
}

/**
 * Register page-close cleanup so the timer never outlives the page.
 * @param args - Tick bundle.
 * @returns True after the listener is registered.
 */
export function wirePageClose(args: ITickArgs): true {
  /**
   * Page `close` event listener — clears the polling interval.
   * @returns DidDetach outcome from detachPoller.
   */
  const onClose = (): DidDetach => detachPoller(args.page, args.state);
  args.page.on('close', onClose);
  return true;
}

/**
 * Wire the polling loop + page-close cleanup. Idempotent via attached set.
 * @param args - Tick bundle.
 * @returns DidAttach(true) iff this call actually attached (false if reused).
 */
export function attachPoller(args: ITickArgs): DidAttach {
  if (args.state.attached.has(args.page)) return false as DidAttach;
  args.state.attached.add(args.page);
  const handler = buildIntervalHandler(args);
  const timer = setInterval(handler, WAF_POLL_INTERVAL_MS);
  args.state.timers.set(args.page, timer);
  handler();
  wirePageClose(args);
  args.logger.debug({ event: 'waf.interceptor.attached' });
  return true as DidAttach;
}

/**
 * beforePhase implementation — attach the poller (once) when browser is available.
 * @param ctx - Pipeline context.
 * @param state - Per-instance state.
 * @returns Always succeed(ctx) — interceptor never fails the pipeline.
 */
export function runBeforePhase(
  ctx: IPipelineContext,
  state: IInterceptorState,
): Procedure<IPipelineContext> {
  if (isDisabled()) return succeed(ctx);
  if (!ctx.browser.has) return succeed(ctx);
  const tick: ITickArgs = { page: ctx.browser.value.page, logger: ctx.logger, state };
  attachPoller(tick);
  return succeed(ctx);
}

/**
 * afterPipeline implementation — detach the poller before browser cleanup.
 * @param ctx - Pipeline context.
 * @param state - Per-instance state.
 * @returns Always succeed(true).
 */
export function runAfterPipeline(
  ctx: IPipelineContext,
  state: IInterceptorState,
): Procedure<boolean> {
  if (ctx.browser.has) detachPoller(ctx.browser.value.page, state);
  return succeed(true);
}

export type {
  DidAttach,
  DidDetach,
  DidTickWork,
  IInterceptorState,
  IsInCooldown,
  ISolverDispatchArgs,
  ITickArgs,
};
