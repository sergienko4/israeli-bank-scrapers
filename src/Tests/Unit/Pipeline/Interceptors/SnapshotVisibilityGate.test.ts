/**
 * Unit tests for Interceptors/SnapshotVisibilityGate — phase anchor gate.
 */

import type { Page } from 'playwright-core';

import { waitForPhaseAnchor } from '../../../../Scrapers/Pipeline/Interceptors/SnapshotVisibilityGate.js';

/**
 * Build a page stub whose locator().first().waitFor() resolves or rejects.
 * @param shouldResolve - True to resolve waitFor immediately.
 * @returns Stub page.
 */
function makePage(shouldResolve: boolean): Page {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    locator: (): {
      first: () => { waitFor: () => Promise<void> };
    } => ({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): { waitFor: () => Promise<void> } => ({
        /**
         * Test helper.
         *
         * @returns Result.
         */
        waitFor: (): Promise<void> =>
          shouldResolve ? Promise.resolve() : Promise.reject(new Error('timeout')),
      }),
    }),
  } as unknown as Page;
}

describe('waitForPhaseAnchor', () => {
  it('returns true immediately for OTP phases (gate disabled)', async () => {
    const page = makePage(false);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'otp-trigger');
    expect(isAnchorVisible).toBe(true);
  });

  it('returns true when phase has no anchors configured', async () => {
    const page = makePage(false);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'unknown-phase');
    expect(isAnchorVisible).toBe(true);
  });

  it('returns true when a locator becomes visible', async () => {
    const page = makePage(true);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'home');
    expect(isAnchorVisible).toBe(true);
  });

  it('returns false when no locator becomes visible (all timeouts)', async () => {
    const page = makePage(false);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'home');
    expect(isAnchorVisible).toBe(false);
  });

  it('returns false when login anchor candidates all timeout', async () => {
    const page = makePage(false);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'login');
    expect(isAnchorVisible).toBe(false);
  });

  it('returns true for scrape phase with visible dashboard anchor', async () => {
    const page = makePage(true);
    const isAnchorVisible = await waitForPhaseAnchor(page, 'scrape');
    expect(isAnchorVisible).toBe(true);
  });
});
