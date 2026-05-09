/**
 * `pollWithBudget` — generic poll-with-budget early-exit. Calls the
 * caller's `probe` immediately; if it returns truthy, that value is
 * the result. Otherwise polls every `intervalMs` until either the
 * probe returns truthy OR the wall-clock budget elapses.
 *
 * Mirrors the proven `awaitFirstId` recursion in
 * `Mediator/Network/NetworkDiscovery.ts:961` so the linter's
 * `no-while-await` and `no-new-Promise` rules stay green.
 *
 * Use-cases: replacing fixed-budget waits like `waitForNetworkIdle(15000)`
 * with race-on-first-success-signal patterns. Each phase that converted
 * a 15s/30s settle into `pollWithBudget` returns the moment the success
 * signal fires, instead of running to the timeout — TIMING mission.
 */

import type { ScraperLogger } from '../../Types/Debug.js';
import { createPromise } from './TimingActions.js';

/** Bundled args for {@link pollWithBudget}. */
export interface IPollArgs<T> {
  /**
   * Caller-owned probe. Returns the success value or `false` to keep
   * polling. May reject — rejections are absorbed and treated as `false`.
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

/**
 * Sleep one interval tick via Reflect-built Promise. Same pattern as
 * `pollTick` in NetworkDiscovery.ts to satisfy the lint set.
 *
 * @param intervalMs - Sleep duration in ms.
 * @returns Resolved `true` after the timer fires.
 */
function tick(intervalMs: number): Promise<true> {
  /**
   * Schedule resolve via setTimeout.
   *
   * @param resolve - Promise resolver.
   * @returns True after the timer is armed.
   */
  const arm = (resolve: (value: true) => boolean): boolean => {
    /**
     * Timer callback — resolves the promise.
     *
     * @returns True to satisfy the typed resolver signature.
     */
    const fire = (): boolean => resolve(true);
    const safeInterval = Math.max(intervalMs, 1);
    globalThis.setTimeout(fire, safeInterval);
    return true;
  };
  return createPromise<true>(arm);
}

/** Internal recursion args. */
interface IPollLoopArgs<T> {
  readonly probe: () => Promise<T | false>;
  readonly intervalMs: number;
  readonly deadline: number;
  readonly logger: ScraperLogger | undefined;
}

/**
 * Run the probe once with rejection-as-false absorption.
 *
 * @param probe - Caller-owned probe.
 * @returns Probe result or `false` on rejection.
 */
async function safeProbe<T>(probe: () => Promise<T | false>): Promise<T | false> {
  try {
    return await probe();
  } catch {
    return false;
  }
}

/**
 * Recursive poll loop — replaces the banned `while + await-in-loop`.
 * Each tick runs the probe; truthy wins, falsy or rejection continues
 * until the deadline passes.
 *
 * @param args - Probe + interval + deadline + logger.
 * @returns First truthy probe value or `false` on timeout.
 */
async function pollLoop<T>(args: IPollLoopArgs<T>): Promise<T | false> {
  const result = await safeProbe(args.probe);
  if (result !== false) return result;
  if (Date.now() >= args.deadline) return false;
  args.logger?.trace({
    module: 'poll-with-budget',
    message: 'tick',
    msUntilDeadline: args.deadline - Date.now(),
  });
  await tick(args.intervalMs);
  return pollLoop(args);
}

/**
 * Block until `args.probe()` returns a non-`false` value or the
 * `args.budgetMs` ceiling elapses. The probe runs immediately on
 * entry; if truthy, no interval timer is ever set. Probe rejections
 * are absorbed (treated as `false`); the loop continues.
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
