/**
 * Retention gate — proves the objects a timing closure captured become
 * collectable once the operation settles.
 *
 * <p>`TimerLeakInvariants.test.ts` asserts the *mechanism* (no timer stays
 * armed). This file asserts the *consequence* that actually caused the
 * production OOM: an armed timer keeps its callback closure alive, and that
 * closure held Playwright `Page`/`Locator` handles and captured response
 * bodies. Counting timers can go green while retention is still broken, so
 * the outcome is worth asserting directly.
 *
 * <p>Uses `WeakRef` plus an explicit `global.gc()`, so it requires Node's
 * `--expose-gc`. Every jest entry point that can select this suite passes that
 * flag, and the suite asserts the hook exists rather than skipping — a vacuous
 * pass here would be worse than no test at all.
 *
 * <p>Real timers on purpose: the point is that a *real* pending timer holds a
 * real reference. Under fake timers the pending callback is held by Jest's
 * timer store instead, which would prove something weaker.
 */

import { waitUntil } from '../../../../../Scrapers/Pipeline/Mediator/Timing/Waiting.js';

const POLL_INTERVAL_MS = 5;
const POLL_TIMEOUT_MS = 30;
/** Long enough that a still-running poll would have re-armed many times. */
const SETTLE_TICKS = 10;
/** Payload big enough that retaining it is unambiguous in a heap snapshot. */
const PAYLOAD_SIZE = 50_000;
/** Bounded collection passes — V8 may need more than one to reclaim. */
const GC_ATTEMPTS = 5;

/** Stand-in for the browser handles a real poll predicate closes over. */
interface ICapturedHandle {
  readonly payload: readonly number[];
}

/** The `global.gc` hook exposed by Node's `--expose-gc` flag. */
type GcHook = (() => unknown) | undefined;

/**
 * Read Node's `--expose-gc` hook, if this process was started with it.
 * @returns The gc function, or undefined when the flag is absent.
 */
function readGcHook(): GcHook {
  const host = globalThis as unknown as { gc?: () => unknown };
  return host.gc;
}

/**
 * Yield to the macrotask queue so settled promise chains are dropped before
 * the collector runs.
 * @returns Resolves on the next macrotask tick.
 */
function nextTick(): Promise<boolean> {
  return new Promise<boolean>((resolve): unknown => {
    /**
     * Resolve once the macrotask queue has turned over.
     * @returns Always true.
     */
    const fire = (): boolean => {
      resolve(true);
      return true;
    };
    return setImmediate(fire);
  });
}

/**
 * Drain several macrotask ticks, giving a still-live poll loop ample
 * opportunity to re-arm and re-capture its closure.
 * @param ticks - Number of macrotask turns to wait.
 * @returns Resolves once the ticks have elapsed.
 */
async function drainTicks(ticks: number): Promise<boolean> {
  const turns = Array.from({ length: ticks }, (): number => 0);
  /**
   * Await the previous turn, then wait one more macrotask.
   * @param memo - Previous turn's promise.
   * @returns Resolves after this turn.
   */
  const step = async (memo: Promise<boolean>): Promise<boolean> => {
    await memo;
    return nextTick();
  };
  const seed = Promise.resolve(true);
  return turns.reduce(step, seed);
}

/**
 * Run `waitUntil` against a predicate that captures `handle` and never
 * succeeds, returning a weak handle on the captured object.
 *
 * <p>The predicate closure is the ONLY strong path to `handle` once the
 * caller drops its own binding, so after the timeout wins and the poll is
 * cancelled nothing should hold it.
 * @param handle - Object the predicate closes over.
 * @returns A weak reference to the handle, observed after the wait settles.
 */
async function runAndReleaseWait(handle: ICapturedHandle): Promise<WeakRef<ICapturedHandle>> {
  const ref = new WeakRef(handle);
  /**
   * Predicate that reads the captured handle and never reports ready.
   * @returns Always false.
   */
  const asyncTest = (): Promise<boolean> => Promise.resolve(handle.payload.length < 0);
  const opts = { timeout: POLL_TIMEOUT_MS, interval: POLL_INTERVAL_MS };
  const pending = waitUntil(asyncTest, 'retention', opts);
  await expect(pending).rejects.toThrow('retention');
  return ref;
}

/**
 * Build the object the poll predicate will capture.
 * @returns A freshly allocated captured-handle stand-in.
 */
function makeCapturedHandle(): ICapturedHandle {
  const payload = new Array<number>(PAYLOAD_SIZE).fill(1);
  return { payload };
}

/**
 * Probe the weak reference without retaining what it points at.
 *
 * <p>Deliberately its own function: binding `deref()` to a local in a
 * longer-lived frame keeps the object strongly reachable and would make the
 * gate fail for the wrong reason.
 * @param ref - Weak reference under observation.
 * @returns True when the referent has been collected.
 */
function hasReferenceCleared(ref: WeakRef<ICapturedHandle>): boolean {
  const survivor = ref.deref();
  return survivor === undefined;
}

/**
 * Sweep the collector until the weak reference clears, or the attempt budget
 * runs out.
 *
 * <p>V8 does not guarantee a single `gc()` reclaims everything — the first
 * pass may only demote the object to an older generation. Retrying with a
 * macrotask yield between passes removes that source of CI flake. The budget
 * is bounded, so a genuine leak still fails rather than looping forever.
 * @param ref - Weak reference under observation.
 * @param gc - Node's `--expose-gc` hook.
 * @returns True once the reference has cleared.
 */
async function collectUntilCleared(ref: WeakRef<ICapturedHandle>, gc: GcHook): Promise<boolean> {
  const attempts = Array.from({ length: GC_ATTEMPTS }, (): number => 0);
  /**
   * Run one collection pass, short-circuiting once the ref has cleared.
   * @param memo - Previous pass's result.
   * @returns True when the reference is gone.
   */
  const sweep = async (memo: Promise<boolean>): Promise<boolean> => {
    const hasCleared = await memo;
    if (hasCleared) return true;
    gc?.();
    await nextTick();
    return hasReferenceCleared(ref);
  };
  const seed = Promise.resolve(false);
  return attempts.reduce(sweep, seed);
}

describe('timing closure retention', () => {
  it('T-RETAIN-1 — releases the handle a timed-out poll captured', async () => {
    const gc = readGcHook();
    expect(typeof gc).toBe('function');
    let handle: ICapturedHandle | undefined = makeCapturedHandle();
    const ref = await runAndReleaseWait(handle);
    // Drop the test's own strong reference: from here the predicate closure
    // is the only path to the payload, which is exactly what we measure.
    handle = undefined;
    await drainTicks(SETTLE_TICKS);
    const hasCleared = await collectUntilCleared(ref, gc);
    expect(hasCleared).toBe(true);
    expect(handle).toBeUndefined();
  });
});
