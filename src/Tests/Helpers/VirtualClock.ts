/**
 * A virtual clock for code that waits through an injected `sleep`.
 *
 * `sleep(ms)` schedules a virtual timer instead of a real one. `run(work)`
 * lets every pending callback run (a few `setImmediate` turns, each draining
 * the microtask queue first); while `work` is still unsettled it jumps to the
 * earliest timer and fires every timer due then. A test reads simulated
 * elapsed time from `now()`, independent of the machine, and minutes of
 * simulated waiting take milliseconds.
 */

/** One pending virtual timer. */
interface ITimer {
  readonly at: number;
  readonly fire: () => boolean;
}

/** Simulated time and the timers not yet fired. */
interface IClockState {
  now: number;
  readonly timers: ITimer[];
}

/** Whether the work under {@link IVirtualClock.run} has settled. */
interface ISettled {
  done: boolean;
}

/** A virtual clock: its time, its sleep, and a runner that moves it. */
export interface IVirtualClock {
  /** Simulated milliseconds since the clock was made. */
  readonly now: () => number;
  /** Resolves with `ms` after `ms` of simulated time. */
  readonly sleep: (ms: number) => Promise<number>;
  /** Settles like `work`, moving simulated time whenever nothing else can run. */
  readonly run: <T>(work: Promise<T>) => Promise<T>;
}

/** `setImmediate` turns that let pending callbacks run before time moves. */
const IDLE_TURNS = 10;

/**
 * Let every pending callback run.
 *
 * @param turns - `setImmediate` turns still to take.
 * @returns Zero, once every turn is taken.
 */
function idle(turns = IDLE_TURNS): Promise<number> {
  const turn = new Promise<number>(resolve => setImmediate(resolve, turns - 1));
  return turns <= 1 ? turn : turn.then(idle);
}

/**
 * Schedule a virtual timer.
 *
 * @param state - The clock.
 * @param ms - Simulated delay.
 * @returns Resolves with `ms` when the clock reaches it.
 */
function schedule(state: IClockState, ms: number): Promise<number> {
  return new Promise<number>(resolve => {
    /**
     * End the sleep.
     *
     * @returns Always true.
     */
    const fire = (): boolean => {
      resolve(ms);
      return true;
    };
    state.timers.push({ at: state.now + ms, fire });
  });
}

/**
 * Jump to the earliest timer and fire every timer due then.
 *
 * @param state - The clock.
 * @returns The new simulated time.
 */
function advance(state: IClockState): number {
  const times = state.timers.map(timer => timer.at);
  if (times.length === 0) throw new RangeError('virtual clock stalled: work pending, no timer');
  const next = Math.min(...times);
  const due = state.timers.filter(timer => timer.at === next);
  const later = state.timers.filter(timer => timer.at !== next);
  state.timers.splice(0, state.timers.length, ...later);
  state.now = next;
  for (const timer of due) timer.fire();
  return next;
}

/**
 * Idle, then advance, until `work` settles.
 *
 * @param state - The clock.
 * @param work - The work under test.
 * @param settled - Set once `work` settles.
 * @returns Settles like `work`.
 */
async function settle<T>(state: IClockState, work: Promise<T>, settled: ISettled): Promise<T> {
  await idle();
  if (settled.done) return work;
  advance(state);
  return settle(state, work, settled);
}

/**
 * Settle like `work`, moving simulated time whenever nothing else can run.
 *
 * @param state - The clock.
 * @param work - The work under test.
 * @returns Settles like `work`.
 */
function runUntilSettled<T>(state: IClockState, work: Promise<T>): Promise<T> {
  const settled: ISettled = { done: false };
  /**
   * Mark the work settled.
   *
   * @returns Always true.
   */
  const mark = (): boolean => {
    settled.done = true;
    return true;
  };
  work.then(mark, mark);
  return settle(state, work, settled);
}

/**
 * A fresh virtual clock at simulated time zero.
 *
 * @returns The clock.
 */
export function virtualClock(): IVirtualClock {
  const state: IClockState = { now: 0, timers: [] };
  return {
    /**
     * Simulated time.
     *
     * @returns Milliseconds since the clock was made.
     */
    now: (): number => state.now,
    /**
     * Wait in simulated time.
     *
     * @param ms - Simulated delay.
     * @returns Resolves with `ms` after it.
     */
    sleep: (ms: number): Promise<number> => schedule(state, ms),
    /**
     * Run work to completion in simulated time.
     *
     * @param work - The work under test.
     * @returns Settles like `work`.
     */
    run: <T>(work: Promise<T>): Promise<T> => runUntilSettled(state, work),
  };
}
