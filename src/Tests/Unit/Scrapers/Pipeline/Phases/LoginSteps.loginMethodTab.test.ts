/**
 * Unit tests for LoginSteps.tryClickLoginMethodTab.
 * Verifies generic tab detection — clicks when present, skips when absent.
 * All banks pass through this step; banks without a method-selection page skip it.
 */

import type { Frame, Page } from 'playwright-core';

import { tryClickLoginMethodTab } from '../../../../../Scrapers/Pipeline/Phases/LoginSteps.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../../../../../Scrapers/Pipeline/Registry/PipelineWellKnown.js';

/** Tab candidates from WellKnown — drives the parameterized test cases. */
const TAB_CANDIDATES = PIPELINE_WELL_KNOWN_LOGIN.loginMethodTab.map(c => [c.value]);

// ── Mock factories ─────────────────────────────────────────

type MockFrame = Page | Frame;

/**
 * Create a mock frame where only `tabText` is visible and clickable.
 * Other texts reject (simulate not-found within timeout).
 * @param tabText - The tab text that should appear visible.
 * @returns Mock frame and click count accessor.
 */
const MAKE_FRAME_WITH_TAB = (
  tabText: string,
): { frame: MockFrame; getClickCount: () => number } => {
  const clickLog: true[] = [];
  const frame = {
    /**
     * Return locator whose waitFor resolves only when text matches tabText.
     * @param text - Text to look up.
     * @returns Locator object.
     */
    getByText: (text: string): object => ({
      /**
       * Return first-element locator with waitFor and click.
       * @returns First locator object.
       */
      first: (): object => ({
        /**
         * Resolve if text === tabText, reject otherwise.
         * @returns Promise<boolean>.
         */
        waitFor: (): Promise<boolean> =>
          text === tabText ? Promise.resolve(true) : Promise.reject(new Error('not visible')),
        /**
         * Record click and resolve.
         * @returns Resolved true.
         */
        click: (): Promise<boolean> => {
          clickLog.push(true);
          return Promise.resolve(true);
        },
      }),
    }),
  } as unknown as Page;
  /**
   * Return number of times click was called.
   * @returns Click count.
   */
  const getClickCount = (): number => clickLog.length;
  return { frame, getClickCount };
};

/**
 * Create a mock frame where no tab text is visible (all waitFor reject).
 * @returns Mock frame and click-flag accessor.
 */
const MAKE_FRAME_WITHOUT_TAB = (): { frame: MockFrame; wasTabClicked: () => boolean } => {
  let hasBeenClicked = false;
  const frame = {
    /**
     * Return locator whose waitFor always rejects (no tab on this page).
     * @returns Locator object.
     */
    getByText: (): object => ({
      /**
       * Return first-element locator.
       * @returns First locator object.
       */
      first: (): object => ({
        /**
         * Always reject — simulates no visible tab within timeout.
         * @returns Rejected promise.
         */
        waitFor: (): Promise<boolean> => Promise.reject(new Error('Timeout 2000ms exceeded')),
        /**
         * Record unexpected click.
         * @returns Resolved true.
         */
        click: (): Promise<boolean> => {
          hasBeenClicked = true;
          return Promise.resolve(true);
        },
      }),
    }),
  } as unknown as Page;
  /**
   * Return whether click was called at any point.
   * @returns True if click was invoked.
   */
  const wasTabClicked = (): boolean => hasBeenClicked;
  return { frame, wasTabClicked };
};

// ── Tests ──────────────────────────────────────────────────

describe('tryClickLoginMethodTab', () => {
  it.each(TAB_CANDIDATES)('returns true and clicks "%s" tab when visible', async tabText => {
    const { frame, getClickCount } = MAKE_FRAME_WITH_TAB(tabText);
    const didClickTab = await tryClickLoginMethodTab(frame);
    const clickCount = getClickCount();
    expect(didClickTab).toBe(true);
    expect(clickCount).toBe(1);
  });

  it('returns false and does not click when no tab is visible', async () => {
    const { frame, wasTabClicked } = MAKE_FRAME_WITHOUT_TAB();
    const didClickTab = await tryClickLoginMethodTab(frame);
    const hasClicked = wasTabClicked();
    expect(didClickTab).toBe(false);
    expect(hasClicked).toBe(false);
  });
});
