/**
 * Timer-leak invariant gate — the regression net for the retention-leak class
 * that caused the production OOM investigated in PR #449.
 *
 * <p>Every defect in that class had the same shape: a `setTimeout` handle was
 * discarded, so the timer stayed armed for its whole budget after the work it
 * guarded had already settled. An armed timer keeps the Node event loop alive
 * AND holds its callback closure reachable — and those closures captured
 * page and browser handles.
 *
 * <p>These tests assert the invariant directly rather than the fix: after any
 * timing entry point settles, `jest.getTimerCount()` must be zero. That makes
 * the gate outlive the specific implementations — a future refactor that
 * reintroduces a discarded handle fails here even if it looks nothing like the
 * code these tests were written against.
 *
 * <p>Scope note: `raceTimeout`/`timeoutPromise` have their own dedicated cases
 * in `RaceTimeoutCancellation.test.ts`. This file covers the bare delay
 * primitives, so no timer owner in the Timing cluster is left unasserted.
 */

import { jest } from '@jest/globals';

import {
  humanDelay,
  sleep as delayFor,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js';

const SLEEP_MS = 25;
const HUMAN_DELAY_MIN_MS = 30;
const HUMAN_DELAY_MAX_MS = 40;

describe('timer-leak invariants', () => {
  beforeEach((): boolean => {
    jest.useFakeTimers();
    return true;
  });

  afterEach((): boolean => {
    jest.useRealTimers();
    return true;
  });

  it('T-LEAK-1 — sleep leaves no timer armed once it resolves', async () => {
    const pending = delayFor(SLEEP_MS);
    await jest.advanceTimersByTimeAsync(SLEEP_MS);
    await expect(pending).resolves.toBe(true);
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });

  it('T-LEAK-2 — humanDelay leaves no timer armed once it resolves', async () => {
    const pending = humanDelay(HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
    await jest.advanceTimersByTimeAsync(HUMAN_DELAY_MAX_MS);
    await pending;
    const pendingTimers = jest.getTimerCount();
    expect(pendingTimers).toBe(0);
  });
});
