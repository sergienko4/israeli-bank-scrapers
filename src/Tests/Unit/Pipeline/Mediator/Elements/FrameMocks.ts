/**
 * Shared Page/Frame mocks for contextId tests.
 *
 * <p>contextIds are minted from real frame objects, never written by hand:
 * an identity token is allocated per Frame instance, so a literal token in
 * a fixture silently stops matching the frame it was meant to name and the
 * assertion around it goes vacuous.
 */

import type { Frame, Page } from 'playwright-core';

/**
 * Build a minimal mock Frame.
 * @param url - Frame URL.
 * @param name - Frame name attribute.
 * @returns Mock frame.
 */
export function makeMockFrame(url: string, name = ''): Frame {
  return {
    /**
     * Frame URL.
     * @returns URL string.
     */
    url: (): string => url,
    /**
     * Frame name.
     * @returns Name string.
     */
    name: (): string => name,
  } as unknown as Frame;
}

/**
 * Build a minimal mock Page that returns a list of frames.
 * @param frames - Child frames (excluding main).
 * @param mainFrame - Explicit main frame.
 * @returns Mock page.
 */
export function makeMockPage(
  frames: Frame[],
  mainFrame: Frame = makeMockFrame('about:main'),
): Page {
  const all = [mainFrame, ...frames];
  return {
    /**
     * Return all frames including main.
     * @returns Frame array.
     */
    frames: (): Frame[] => all,
    /**
     * Return main frame.
     * @returns Main frame.
     */
    mainFrame: (): Frame => mainFrame,
  } as unknown as Page;
}
