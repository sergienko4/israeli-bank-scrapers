/**
 * Unit tests for raceLocatorsFirstHit — the single-winner short-circuit
 * race behind resolveVisible / resolveVisibleNthAware / resolveVisibleInContext.
 *
 * Proves the Gap-K perf contract: settle on the FIRST hit-testable locator
 * without waiting for every candidate (a never-settling candidate must NOT
 * block a passing one), while preserving the tier-2 "first merely-visible"
 * fallback that the multi-winner resolveWinner uses for overlays.
 */

import type { Locator } from 'playwright-core';

import { raceLocatorsFirstHit } from '../../../../../Scrapers/Pipeline/Mediator/Elements/Create/Hittest.js';
import { makeRichLocator } from './CreateElementMediatorExtraHelpers.js';

const TIMEOUT_MS = 500;

/**
 * Locator whose visibility wait never settles — proves the race
 * short-circuits instead of blocking on a slow candidate.
 * @returns A Locator stub with a never-resolving waitFor.
 */
function makeHangingLocator(): Locator {
  const self = {
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * waitFor — never settles (mirrors makeRichPage's Promise.race([])).
     * @returns A promise that never resolves.
     */
    waitFor: (): Promise<void> => Promise.race([]),
  };
  return self as unknown as Locator;
}

describe('raceLocatorsFirstHit — single-winner short-circuit', () => {
  it('returns -1 diagnostic for an empty locator list', async () => {
    const diag = await raceLocatorsFirstHit([], TIMEOUT_MS);
    expect(diag.winner).toBe(-1);
    expect(diag.fulfilledCount).toBe(0);
    expect(diag.fulfilledIndices).toEqual([]);
  });

  it('returns -1 when no locator becomes visible', async () => {
    const locators = [makeRichLocator({ visible: false }), makeRichLocator({ visible: false })];
    const diag = await raceLocatorsFirstHit(locators, TIMEOUT_MS);
    expect(diag.winner).toBe(-1);
    expect(diag.hitTestPassedCount).toBe(0);
  });

  it('returns the first hit-test-passing locator', async () => {
    const locators = [
      makeRichLocator({ visible: false }),
      makeRichLocator({ visible: true, hitTest: true }),
    ];
    const diag = await raceLocatorsFirstHit(locators, TIMEOUT_MS);
    expect(diag.winner).toBe(1);
    expect(diag.hitTestPassedCount).toBe(1);
    expect(diag.fulfilledIndices).toEqual([1]);
  });

  it('prefers a hit-test winner over an earlier visible-only locator', async () => {
    const locators = [
      makeRichLocator({ visible: true, hitTest: false }),
      makeRichLocator({ visible: true, hitTest: true }),
    ];
    const diag = await raceLocatorsFirstHit(locators, TIMEOUT_MS);
    expect(diag.winner).toBe(1);
    expect(diag.hitTestPassedCount).toBe(1);
  });

  it('falls back to the first visible locator when none pass hit-test', async () => {
    const locators = [makeRichLocator({ visible: true, hitTest: false })];
    const diag = await raceLocatorsFirstHit(locators, TIMEOUT_MS);
    expect(diag.winner).toBe(0);
    expect(diag.fulfilledCount).toBe(1);
    expect(diag.hitTestPassedCount).toBe(0);
  });

  it('short-circuits: a never-settling locator does not block a passing one', async () => {
    const locators = [makeHangingLocator(), makeRichLocator({ visible: true, hitTest: true })];
    const diag = await raceLocatorsFirstHit(locators, TIMEOUT_MS);
    expect(diag.winner).toBe(1);
    expect(diag.hitTestPassedCount).toBe(1);
  }, 2000);
});
