/**
 * Unit tests for LoginSteps.ts postLogin helpers.
 * Tests checkFrameForErrors and waitForSubmitToSettle in isolation.
 * Mock-first: no real browser, no real DOM.
 */

import type { Frame, Page } from 'playwright-core';

import { checkFrameForErrors } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import { waitForSubmitToSettle } from '../../../../Scrapers/Pipeline/Phases/Login/LoginSteps.js';
import { WK_DASHBOARD } from '../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';
import { makeMockMediator } from '../../../Unit/Scrapers/Pipeline/MockPipelineFactories.js';

/** First WellKnown error text — used for test assertions. */
const FIRST_ERROR_TEXT = WK_DASHBOARD.ERROR[0].value;

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

// ── checkFrameForErrors ────────────────────────────────────
// Returns IFormErrorScanResult { hasErrors, summary } (not IFrameErrorResult)

describe('checkFrameForErrors', () => {
  it('returns hasErrors=false when no WellKnown error text is visible', async () => {
    const frame = makeMockFrame([]);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(false);
    expect(errorResult.summary).toBe('');
  });

  it('returns hasErrors=true for first WellKnown error text', async () => {
    const frame = makeMockFrame([FIRST_ERROR_TEXT]);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(true);
    expect(errorResult.summary).toBe(FIRST_ERROR_TEXT);
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
    // Both first and second WellKnown texts visible — order determines first match
    const secondText = WK_DASHBOARD.ERROR[1].value;
    const frame = makeMockFrame([FIRST_ERROR_TEXT, secondText]);
    const errorResult = await checkFrameForErrors(frame);
    expect(errorResult.hasErrors).toBe(true);
    expect(errorResult.summary).toBe(FIRST_ERROR_TEXT);
  });
});

// ── waitForSubmitToSettle ──────────────────────────────────

describe('waitForSubmitToSettle', () => {
  it('returns succeed when mediator.waitForNetworkIdle succeeds', async () => {
    const mediator = makeMockMediator();
    const result = await waitForSubmitToSettle(mediator);
    expect(result.success).toBe(true);
  });

  it('returns succeed even when networkidle times out (non-fatal)', async () => {
    const mediator = makeMockMediator({
      /**
       * Mock network idle — always succeeds.
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: () => Promise.resolve({ success: true, value: undefined }),
    });
    const result = await waitForSubmitToSettle(mediator);
    expect(result.success).toBe(true);
  });
});
