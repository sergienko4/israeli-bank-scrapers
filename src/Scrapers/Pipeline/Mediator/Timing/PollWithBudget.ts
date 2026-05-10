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
 * Build a deadline-guard promise that resolves to the
 * {@link DEADLINE_REACHED} sentinel when the wall-clock budget
 * elapses. Used to race against a hung probe.
 *
 * @param remainingMs - Milliseconds remaining until the deadline.
 * @returns Promise that resolves to the sentinel after `remainingMs`.
 */
function deadlineGuard(remainingMs: number): Promise<typeof DEADLINE_REACHED> {
  const safeRemaining = Math.max(remainingMs, 0);
  return createPromise<typeof DEADLINE_REACHED>((resolve): boolean => {
    globalThis.setTimeout((): boolean => resolve(DEADLINE_REACHED), safeRemaining);
    return true;
  });
}

/**
 * Run the probe once with rejection-as-false absorption AND budget-
 * race protection. A probe that never resolves loses to the deadline
 * guard so the loop never stalls past the configured budget.
 *
 * @param probe - Caller-owned probe.
 * @param deadline - Absolute epoch-ms wall-clock ceiling.
 * @returns Probe result, `false` on rejection or timeout.
 */
async function safeProbe<T>(probe: () => Promise<T | false>, deadline: number): Promise<T | false> {
  const probeCall = probe().catch((): false => false);
  const remainingMs = deadline - Date.now();
  const racer = deadlineGuard(remainingMs);
  const winner = await Promise.race([probeCall, racer]);
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
 * @param args - Probe + interval + budget + optional logger.
 * @returns First truthy probe value or `false` on budget elapse.
 */
export function pollWithBudget<T>(args: IPollArgs<T>): Promise<T | false> {
  const deadline = Date.now() + args.budgetMs;
  return pollLoop({
    probe: args.probe,
    intervalMs: args.intervalMs,
    deadline,
    logger: args.logger,
  });
}
