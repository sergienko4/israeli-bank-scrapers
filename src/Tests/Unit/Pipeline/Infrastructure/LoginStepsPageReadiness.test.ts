/**
 * Unit tests for generic page readiness wait in LoginSteps.
 * Tests waitForAnyLoginLink and waitForFirstField.
 */

import type { Locator, Page } from 'playwright-core';

import {
  waitForAnyLoginLink,
  waitForFirstField,
} from '../../../../Scrapers/Pipeline/Phases/GenericPreLoginSteps.js';
import { WK } from '../../../../Scrapers/Pipeline/Registry/PipelineWellKnown.js';

/**
 * Build a mock page where specific texts become visible.
 * @param visibleTexts - Texts that appear visible.
 * @returns Mock Page.
 */
function makeVisiblePage(visibleTexts: readonly string[]): Page {
  /**
   * Build locator mock.
   * @param text - The text.
   * @returns Locator.
   */
  const buildLoc = (text: string): Locator => {
    const isVisible = visibleTexts.includes(text);
    const loc = {
      /**
       * Return self.
       * @returns This.
       */
      first: (): Locator => loc,
      /**
       * Wait for visibility.
       * @returns Resolves if visible, rejects if not.
       */
      waitFor: (): Promise<boolean> => {
        if (isVisible) return Promise.resolve(true);
        const err = new Error('not visible');
        return Promise.reject(err);
      },
    } as unknown as Locator;
    return loc;
  };
  return {
    /**
     * Build locator by text.
     * @param text - Text to match.
     * @returns Locator mock.
     */
    getByText: (text: string | RegExp): Locator => {
      const textStr = String(text);
      return buildLoc(textStr);
    },
    /**
     * Build locator by label.
     * @param text - Label text.
     * @returns Locator mock.
     */
    getByLabel: (text: string): Locator => buildLoc(text),
    /**
     * Build locator by placeholder.
     * @param text - Placeholder text.
     * @returns Locator mock.
     */
    getByPlaceholder: (text: string): Locator => buildLoc(text),
  } as unknown as Page;
}

describe('waitForAnyLoginLink', () => {
  it('resolves true when a WellKnown loginLink text is visible', async () => {
    const loginText = (WK.HOME.ACTION.NAV_ENTRY[0] as { value: string }).value;
    const page = makeVisiblePage([loginText]);
    const isReady = await waitForAnyLoginLink(page);
    expect(isReady).toBe(true);
  });

  it('resolves false when no loginLink text is visible', async () => {
    const page = makeVisiblePage([]);
    const isReady = await waitForAnyLoginLink(page);
    expect(isReady).toBe(false);
  });

  it('resolves true for "כניסה לאיזור האישי" (Max text)', async () => {
    const page = makeVisiblePage(['כניסה לאיזור האישי']);
    const isReady = await waitForAnyLoginLink(page);
    expect(isReady).toBe(true);
  });
});

describe('waitForFirstField', () => {
  it('resolves true when field placeholder becomes visible', async () => {
    const page = makeVisiblePage(['שם משתמש']);
    const isReady = await waitForFirstField(page);
    expect(isReady).toBe(true);
  });

  it('resolves false when no field text is visible', async () => {
    const page = makeVisiblePage([]);
    const isReady = await waitForFirstField(page);
    expect(isReady).toBe(false);
  });
});
