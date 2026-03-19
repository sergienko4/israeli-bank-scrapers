/**
 * Unit tests for LoginSteps.ts postLogin helpers.
 * Tests checkFrameForErrors and waitForSubmitToSettle in isolation.
 * Mock-first: no real browser, no real DOM.
 */

import type { Frame, Page } from 'playwright-core';

import { checkFrameForErrors } from '../../../../Scrapers/Pipeline/Mediator/FormErrorDiscovery.js';
import { waitForSubmitToSettle } from '../../../../Scrapers/Pipeline/Phases/LoginSteps.js';

// ── Mock helpers ───────────────────────────────────────────

/**
 * Build a mock Frame/Page where getByText + isVisible is controllable.
 * @param visibleTexts - Texts that should appear "visible" in this frame.
 * @returns Mock Page usable as Frame or Page parameter.
 */
function makeMockFrame(visibleTexts: readonly string[]): Page | Frame {
  return {
    /**
     * Return a locator whose visibility depends on visibleTexts.
     * @param text - Text to look up.
     * @returns Locator-like mock.
     */
    getByText: (text: string) => ({
      /**
       * Return first() element locator.
       * @returns First-element locator mock.
       */
      first: () => ({
        /**
         * Returns true if text is in the visibleTexts list.
         * @returns Promise<boolean> for visibility.
         */
        isVisible: (): Promise<boolean> => {
          const isFound = visibleTexts.includes(text);
          return Promise.resolve(isFound);
        },
      }),
    }),
  } as unknown as Page;
}

/**
 * Build a mock Frame where isVisible always throws (detached frame scenario).
 * @returns Mock Page simulating a detached frame.
 */
function makeDetachedFrame(): Page | Frame {
  return {
    /**
     * Throws to simulate a detached frame context.
     * @returns Throws immediately.
     */
    getByText: () => ({
      /**
       * Return first() element of detached locator.
       * @returns Detached first locator.
       */
      first: () => ({
        /**
         * Rejects to simulate frame detachment.
         * @returns Rejected promise.
         */
        isVisible: (): Promise<boolean> => Promise.reject(new Error('Frame detached')),
      }),
    }),
  } as unknown as Page;
}

/**
 * Build a mock Page where waitForLoadState resolves immediately.
 * @returns Mock Page that settles instantly.
 */
function makeFastSettlePage(): Page {
  return {
    /**
     * Resolves immediately — page is idle.
     * @returns Resolved promise.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

/**
 * Build a mock Page where waitForLoadState always times out.
 * @returns Mock Page that never reaches networkidle.
 */
function makeTimeoutPage(): Page {
  return {
    /**
     * Always rejects to simulate network-idle timeout.
     * @returns Rejected promise.
     */
    waitForLoadState: (): Promise<boolean> =>
      Promise.reject(new Error('Timeout: networkidle not reached')),
  } as unknown as Page;
}

// ── checkFrameForErrors ────────────────────────────────────
// Returns IFormErrorScanResult { hasErrors, summary } (not IFrameErrorResult)

describe('checkFrameForErrors', () => {
  it('returns hasErrors=false when no WellKnown error text is visible', async () => {
    const frame = makeMockFrame([]);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(false);
    expect(errorResult.summary).toBe('');
  });

  it('returns hasErrors=true for Discount error text "פרטים שגויים"', async () => {
    const frame = makeMockFrame(['פרטים שגויים']);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(true);
    expect(errorResult.summary).toBe('פרטים שגויים');
  });

  it('returns hasErrors=true for VisaCal error "שם המשתמש או הסיסמה שהוזנו שגויים"', async () => {
    const visaCalError = 'שם המשתמש או הסיסמה שהוזנו שגויים';
    const frame = makeMockFrame([visaCalError]);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(true);
    expect(errorResult.summary).toBe(visaCalError);
  });

  it('returns hasErrors=false when frame is detached (isVisible throws)', async () => {
    const frame = makeDetachedFrame();
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(false);
    expect(errorResult.summary).toBe('');
  });

  it('stops on first match and returns that candidate', async () => {
    // Both "פרטים שגויים" and "שגיאה" visible — WellKnown order determines first
    const frame = makeMockFrame(['פרטים שגויים', 'שגיאה']);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(true);
    expect(errorResult.summary).toBe('פרטים שגויים');
  });
});

// ── waitForSubmitToSettle ──────────────────────────────────

describe('waitForSubmitToSettle', () => {
  it('resolves true when page reaches networkidle quickly', async () => {
    const page = makeFastSettlePage();
    const hasSettled = await waitForSubmitToSettle(page);
    expect(hasSettled).toBe(true);
  });

  it('resolves true even when networkidle times out (does not throw)', async () => {
    const page = makeTimeoutPage();
    const hasSettled = await waitForSubmitToSettle(page);
    expect(hasSettled).toBe(true);
  });
});
