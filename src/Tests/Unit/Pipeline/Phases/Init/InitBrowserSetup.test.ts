/**
 * Unit tests for Phases/Init/InitBrowserSetup — safe close helper.
 */

import type { Browser } from 'playwright-core';

import { closeBrowserSafe } from '../../../../../Scrapers/Pipeline/Phases/Init/InitBrowserSetup.js';

describe('closeBrowserSafe', () => {
  it('returns false when browser handle is false', async () => {
    const didClose = await closeBrowserSafe(false);
    expect(didClose).toBe(false);
  });

  it('returns true when close resolves', async () => {
    const browser = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => Promise.resolve(),
    } as unknown as Browser;
    const didClose = await closeBrowserSafe(browser);
    expect(didClose).toBe(true);
  });

  it('returns false when close rejects', async () => {
    const browser = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => Promise.reject(new Error('already closed')),
    } as unknown as Browser;
    const didClose = await closeBrowserSafe(browser);
    expect(didClose).toBe(false);
  });
});
