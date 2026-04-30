/**
 * Mock timing policy — shared utility for MOCK_MODE-aware timeout capping.
 *
 * In MOCK_MODE the DOM comes from local snapshots: either an element is in
 * the HTML or it isn't. Waiting 15 s for a probe that's going to fail is
 * wasted time. This module caps every wait to MOCK_TIMEOUT_MS so the whole
 * 7-bank suite can complete in seconds instead of minutes.
 *
 * Call `capTimeout(requested)` anywhere a timeout is passed to Playwright.
 * When MOCK_MODE is unset, the original value is returned unchanged.
 */

/** Milliseconds value — type alias for timeout durations. */
type TimeoutMs = number;
/** Whether mock-timing caps should apply. */
type IsMockTimingActive = boolean;

/** Env flag that activates mock-timing compression. */
const MOCK_ENV_FLAG = 'MOCK_MODE';

/** Hard ceiling for every mock-mode wait (milliseconds). Tuned for parallel
 * execution — parallel browser instances share CPU, so hit-tests that take
 * ~100 ms sequentially can take ~700 ms under 6-way contention. */
const MOCK_TIMEOUT_MS = 5000;

/**
 * Check whether mock-timing caps apply to this run.
 * @returns True when MOCK_MODE is set to 1/true.
 */
function isMockTimingActive(): IsMockTimingActive {
  const val = process.env[MOCK_ENV_FLAG];
  return val === '1' || val === 'true';
}

/**
 * Cap a Playwright timeout when MOCK_MODE is active.
 * @param requested - The caller's requested timeout in milliseconds.
 * @returns Capped timeout — 1000 ms when mocking, original otherwise.
 */
function capTimeout(requested: TimeoutMs): TimeoutMs {
  if (!isMockTimingActive()) return requested;
  if (requested <= MOCK_TIMEOUT_MS) return requested;
  return MOCK_TIMEOUT_MS;
}

export { capTimeout, isMockTimingActive, MOCK_TIMEOUT_MS };
