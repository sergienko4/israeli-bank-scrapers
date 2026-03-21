/**
 * Unit tests for VisaCal preAction — openLoginForm + waitUntilIframeFound.
 * Uses jest.unstable_mockModule to mock waitUntilIframeFound before dynamic import.
 */

import { jest } from '@jest/globals';
import type { Frame, Locator, Page } from 'playwright-core';

/** Mock frame returned by waitUntilIframeFound. */
const MOCK_FRAME: Frame = {
  /**
   * Return a connect URL to match isConnect predicate.
   * @returns Connect iframe URL.
   */
  url: () => 'https://connect.cal-online.co.il/regular-login',
} as unknown as Frame;

/** Whether click was called on a locator. */
let wasClickCalled = false;

/** Sentinel locator for mock page getBy* methods. */
const SENTINEL_LOCATOR: Locator = {
  /**
   * Return self for chaining.
   * @returns This locator.
   */
  first: () => SENTINEL_LOCATOR,
  /**
   * WaitFor mock — resolves immediately.
   * @returns Resolved.
   */
  waitFor: (): Promise<boolean> => Promise.resolve(true),
  /**
   * Click mock — records call.
   * @returns Resolved.
   */
  click: (): Promise<boolean> => {
    wasClickCalled = true;
    return Promise.resolve(true);
  },
} as unknown as Locator;

/**
 * Create a mock page for preAction tests.
 * All getBy* methods return SENTINEL_LOCATOR.
 * @returns Mock Page.
 */
function makeMockPage(): Page {
  wasClickCalled = false;
  return {
    /**
     * Mock getByText — returns sentinel.
     * @returns Sentinel locator.
     */
    getByText: (): Locator => SENTINEL_LOCATOR,
    /**
     * Mock getByLabel — returns sentinel.
     * @returns Sentinel locator.
     */
    getByLabel: (): Locator => SENTINEL_LOCATOR,
    /**
     * Mock getByPlaceholder — returns sentinel.
     * @returns Sentinel locator.
     */
    getByPlaceholder: (): Locator => SENTINEL_LOCATOR,
  } as unknown as Page;
}

/** Mock only waitUntilIframeFound — spread actual module for other exports. */
const ACTUAL = await import('../../../../../../Common/ElementsInteractions.js');
jest.unstable_mockModule('../../../../../../Common/ElementsInteractions.js', () => ({
  ...ACTUAL,
  /**
   * Call the predicate with MOCK_FRAME then return it.
   * @param _page - Unused page.
   * @param predicate - Frame predicate to exercise.
   * @returns Resolved mock frame.
   */
  waitUntilIframeFound: (_page: Page, predicate: (_f: Frame) => boolean): Promise<Frame> => {
    predicate(MOCK_FRAME);
    return Promise.resolve(MOCK_FRAME);
  },
}));

/** Dynamically import after mock registration. */
const { VISACAL_LOGIN } =
  await import('../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js');

describe('VISACAL_LOGIN.preAction', () => {
  it('clicks login link and returns connect iframe', async () => {
    const page = makeMockPage();
    const frame = await VISACAL_LOGIN.preAction?.(page);
    expect(wasClickCalled).toBe(true);
    expect(frame).toBe(MOCK_FRAME);
    const url = MOCK_FRAME.url();
    expect(url).toContain('connect');
  });
});
