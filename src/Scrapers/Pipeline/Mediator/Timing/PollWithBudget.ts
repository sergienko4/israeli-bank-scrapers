/**
 * `pollWithBudget` — generic poll-with-budget early-exit. Calls the
 * caller's `probe` immediately; if it returns truthy, that value is
 * the result. Otherwise polls every `intervalMs` until either the
 * probe returns truthy OR the wall-clock budget elapses.
 *
 * <p>Mirrors the proven `awaitFirstId` recursion in
 * `Mediator/Network/NetworkDiscovery.ts:961` so the linter's
 * `no-while-await` and `no-new-Promise` rules stay green.
 *
 * <p>Probe-hang protection: every probe invocation races against the
 * remaining budget. A probe that never resolves cannot stall the
 * pipeline past `args.budgetMs` — the deadline guard wins the race
 * and the loop exits with `false`.
 */

import type { ScraperLogger } from '../../Types/Debug.js';
import { createPromise } from './TimingActions.js';

/** Bundled args for {@link pollWithBudget}. */
export interface IPollArgs<T> {
  /**
   * Caller-owned probe. Returns the success value or `false` to
   * keep polling. May reject — rejections are absorbed and treated
   * as `false`. May hang — the budget guard caps total wall time.
   */
  readonly probe: () => Promise<T | false>;
  /**
   * Interval between probes in ms. Minimum 1; the helper clamps to
   * `Math.max(intervalMs, 1)` defensively.
   */
  readonly intervalMs: number;
  /** Wall-clock ceiling in ms. Returns `false` once exceeded. */
  readonly budgetMs: number;
  /** Optional pino logger; emits `trace` on each tick. */
  readonly logger?: ScraperLogger;
}

/** Internal recursion args (carries deadline + clamped interval). */
interface IPollLoopArgs<T> {
  readonly probe: () => Promise<T | false>;
  readonly intervalMs: number;
  readonly deadline: number;
  readonly logger: ScraperLogger | undefined;
}

/** Sentinel returned when the deadline guard wins a probe race. */
const DEADLINE_REACHED = Symbol('poll-with-budget:deadline');

/**
 * Clamp the user-supplied interval to a sane floor (1 ms). Pulled out
 * so {@link tick} stays inside the project's per-method line budget.
 *
 * @param intervalMs - Raw interval value from caller.
 * @returns Clamped interval (≥ 1).
 */
function clampIntervalMs(intervalMs: number): number {
  return Math.max(intervalMs, 1);
}

/**
 * Sleep one interval tick. Mirrors `pollTick` in NetworkDiscovery.ts
 * to satisfy the no-`new`-Promise rule.
 *
 * @param intervalMs - Sleep duration in ms.
 * @returns Resolved `true` after the timer fires.
 */
function tick(intervalMs: number): Promise<true> {
  const safeInterval = clampIntervalMs(intervalMs);
  return createPromise<true>((resolve): boolean => {
    globalThis.setTimeout((): boolean => resolve(true), safeInterval);
    return true;
  });
}

/**
 * Bundled deadline-guard handle. Holds the racer promise alongside a
 * `cancel` closure that clears the underlying `setTimeout` so the
 * handle does not leak when the probe wins the race.
 *
 * <p>PR #221 review finding B.1: previously the `setTimeout` queued
 * by the deadline guard was never cleared on probe-win, accumulating
 * pending timers across recursion ticks under frequent polling.
 */
interface IDeadlineRace {
  readonly racer: Promise<typeof DEADLINE_REACHED>;
  /**
   * Clear the pending deadline `setTimeout`. Returns `true` so the
   * helper satisfies the architecture rule against `void` returns.
   */
  readonly cancel: () => true;
}

/**
 * Build a cancellable deadline-guard race. The returned `racer`
 * resolves to {@link DEADLINE_REACHED} once `remainingMs` elapses;
 * `cancel()` clears the pending timer when the probe wins so the
 * timer queue does not leak.
 *
 * <p>The Promise constructor runs its executor synchronously, so
 * `handle` is always defined by the time `cancel()` can be invoked.
 * Captured via `let resolveSentinel` so the `setTimeout` is queued
 * outside the executor and the handle reference is unconditional —
 * removes a dead `if (handle !== undefined)` branch.
 *
 * @param remainingMs - Milliseconds remaining until the deadline.
 * @returns Racer promise + cancellation closure.
 */
function deadlineGuard(remainingMs: number): IDeadlineRace {
  const safeRemaining = Math.max(remainingMs, 0);
  // Definite-init no-op (returns boolean to satisfy the architecture
  // rule against `void` returns). The createPromise executor runs
  // synchronously below and overwrites this with the real resolve
  // before the timer callback can ever fire — no `| undefined`
  // branch needed.
  // Definite-assignment assertion (`!:`) — `createPromise` runs its
  // executor synchronously below, binding the real resolver before
  // `setTimeout` can ever fire. No placeholder no-op is needed (a
  // never-called placeholder would show as an uncovered function in
  // coverage reports).
  let resolveSentinel!: (v: typeof DEADLINE_REACHED) => boolean;
  const racer = createPromise<typeof DEADLINE_REACHED>((resolve): boolean => {
    /**
     * Sentinel resolver bound to the racer promise. Returns `true`
     * to satisfy the no-`void` architecture rule.
     *
     * @param val - The DEADLINE_REACHED sentinel.
     * @returns True after resolving the racer.
     */
    const realResolve = (val: typeof DEADLINE_REACHED): boolean => {
      resolve(val);
      return true;
    };
    resolveSentinel = realResolve;
    return true;
  });
  const handle = globalThis.setTimeout(
    (): boolean => resolveSentinel(DEADLINE_REACHED),
    safeRemaining,
  );
  return {
    racer,
    /**
     * Cancel the pending timeout when the probe wins the race so the
     * queued timer does not fire later and waste resources. Returns
     * truthy to satisfy the no-`void` architecture rule.
     *
     * @returns True after the timeout has been cleared.
     */
    cancel: (): true => {
      globalThis.clearTimeout(handle);
      return true;
    },
  };
}

/**
 * Run the probe once with rejection-as-false absorption AND budget-
 * race protection. A probe that never resolves loses to the deadline
 * guard so the loop never stalls past the configured budget. The
 * pending guard timer is always cancelled before return — no timer
 * leak whether probe wins or guard wins (PR #221 review B.1).
 *
 * @param probe - Caller-owned probe.
 * @param deadline - Absolute epoch-ms wall-clock ceiling.
 * @returns Probe result, `false` on rejection or timeout.
 */
async function safeProbe<T>(probe: () => Promise<T | false>, deadline: number): Promise<T | false> {
  const probeCall = probe().catch((): false => false);
  const remainingMs = deadline - Date.now();
  const guard = deadlineGuard(remainingMs);
  const winner = await Promise.race([probeCall, guard.racer]);
  guard.cancel();
  if (winner === DEADLINE_REACHED) return false;
  return winner;
}

/**
 * Emit one trace event per polling tick. Pulled out so {@link pollLoop}
 * stays inside the per-method line budget. Returns truthy to satisfy
 * the no-`void` architecture rule.
 *
 * @param args - Loop args (uses logger + deadline only).
 * @returns True after the trace is emitted (or noop when no logger).
 */
function traceTick<T>(args: IPollLoopArgs<T>): boolean {
  args.logger?.trace({
    module: 'poll-with-budget',
    message: 'tick',
    msUntilDeadline: args.deadline - Date.now(),
  });
  return true;
}

/**
 * Recursive poll loop — replaces the banned `while + await-in-loop`.
 * Each iteration runs the probe (race-protected against budget) and
 * either returns the truthy result or sleeps one tick before
 * recursing. Stays under the 10-line ceiling via helpers.
 *
 * @param args - Probe + interval + deadline + logger.
 * @returns First truthy probe value or `false` on timeout.
 */
async function pollLoop<T>(args: IPollLoopArgs<T>): Promise<T | false> {
  const result = await safeProbe(args.probe, args.deadline);
  if (result !== false) return result;
  if (Date.now() >= args.deadline) return false;
  traceTick(args);
  await tick(args.intervalMs);
  return pollLoop(args);
}

/**
 * Block until `args.probe()` returns a non-`false` value or the
 * `args.budgetMs` ceiling elapses. The probe runs immediately on
 * entry; if truthy, no interval timer is ever set. Probe rejections
 * are absorbed; probe hangs are capped by the deadline guard.
 *
 * <p>Contract: when `budgetMs <= 0` the budget is already exhausted,
 * so the function returns `false` synchronously WITHOUT calling the
 * probe. PR #221 review finding B.2 — without this short-circuit
 * the probe would still run and could return truthy before the
 * past-deadline check inside `pollLoop` rejects it, violating
 * "returns false once exceeded" for exhausted budgets.
 *
 * @param args - Probe + interval + budget + optional logger.
 * @returns First truthy probe value or `false` on budget elapse.
 */
export function pollWithBudget<T>(args: IPollArgs<T>): Promise<T | false> {
  if (args.budgetMs <= 0) return Promise.resolve<T | false>(false);
  const deadline = Date.now() + args.budgetMs;
  return pollLoop({
    probe: args.probe,
    intervalMs: args.intervalMs,
    deadline,
    logger: args.logger,
  });
}
