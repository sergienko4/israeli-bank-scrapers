/**
 * Regression tests proving a settled race leaves no pending timer.
 *
 * <p>`createTimeoutRejector` used to call `clearTimeout` from inside its own
 * callback, so the timer was only ever cleared by firing. Every `raceTimeout`
 * call therefore kept the Node event loop alive for the full budget and held
 * its captured closure — including whole browser objects — reachable. With
 * multi-minute budgets that is both a shutdown stall and a retention leak.
 */

import { jest } from '@jest/globals';

import {
  RACE_TIMED_OUT,
  raceTimeout,
  timeoutPromise,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';

const LONG_BUDGET_MS = 600_000;
const SHORT_BUDGET_MS = 5;

/**
 * Build a promise that never settles, standing in for a hung operation.
 * @returns A forever-pending promise.
 */
function neverSettles(): Promise<string> {
  return new Promise<string>((): boolean => true);
}

describe('raceTimeout timer cancellation', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  it('T-TIMER-1 — clears the pending timer once the raced promise resolves', async () => {
    const settled = Promise.resolve('done');
    await raceTimeout(LONG_BUDGET_MS, settled);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-TIMER-2 — clears the pending timer once the raced promise rejects', async () => {
    const rejected = Promise.reject(new Error('boom'));
    const raced = raceTimeout(LONG_BUDGET_MS, rejected);
    await expect(raced).rejects.toThrow('boom');
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-TIMER-3 — clears the pending timer on the timeoutPromise success path', async () => {
    const settled = Promise.resolve('ok');
    await timeoutPromise(LONG_BUDGET_MS, settled, 'probe');
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-TIMER-4 — still returns the raced value after cancelling the timer', async () => {
    const settled = Promise.resolve('value');
    const value = await raceTimeout(LONG_BUDGET_MS, settled);
    expect(value).toBe('value');
  });

  it('T-TIMER-5 — still reports the sentinel when the timeout wins', async () => {
    const hung = neverSettles();
    const raced = raceTimeout(SHORT_BUDGET_MS, hung);
    jest.advanceTimersByTime(SHORT_BUDGET_MS);
    await expect(raced).resolves.toBe(RACE_TIMED_OUT);
  });

  it('T-TIMER-6 — leaves no timer behind after the timeout path settles', async () => {
    const hung = neverSettles();
    const raced = raceTimeout(SHORT_BUDGET_MS, hung);
    jest.advanceTimersByTime(SHORT_BUDGET_MS);
    await raced;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });
});
