/**
 * Regression tests for launchBrowser's prepareBrowser failure path.
 *
 * <p>The hook runs after launch but before launchBrowser returns, so a
 * rejection used to propagate while the caller still held no handle. Its
 * catch block called closeBrowserSafe(false) — a no-op — and the Camoufox
 * process survived the failed scrape for the life of the host process.
 */

import { jest } from '@jest/globals';
import type { Browser } from 'playwright-core';

import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';

const LAUNCH_CAMOUFOX_MOCK = jest.fn();

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js',
  () => ({
    launchCamoufox: LAUNCH_CAMOUFOX_MOCK,
  }),
);

const SETUP_MOD = await import('../../../../../Scrapers/Pipeline/Phases/Init/InitBrowserSetup.js');

/** A fake browser that records whether it was closed. */
interface IFakeBrowser {
  /** The handle handed to production code. */
  readonly browser: Browser;
  /** Live read of whether close() has been called. */
  readonly wasClosed: () => boolean;
}

/**
 * Build a browser stub tracking its own close() calls.
 * @returns The stub handle plus a close observer.
 */
function makeFakeBrowser(): IFakeBrowser {
  let isClosed = false;
  /**
   * Record the close call.
   * @returns Resolved once the close is recorded.
   */
  const close = (): Promise<void> => {
    isClosed = true;
    return Promise.resolve();
  };
  /**
   * Read whether close() has run.
   * @returns True once close() was called.
   */
  const wasClosed = (): boolean => isClosed;
  return { browser: { close } as unknown as Browser, wasClosed };
}

/**
 * Build scraper options carrying an optional prepareBrowser hook.
 * @param prepareBrowser - Hook to attach, or undefined for none.
 * @returns Options accepted by launchBrowser.
 */
function makeOptions(prepareBrowser?: (browser: Browser) => Promise<void>): ScraperOptions {
  return {
    companyId: 'hapoalim',
    shouldShowBrowser: false,
    prepareBrowser,
  } as unknown as ScraperOptions;
}

describe('launchBrowser prepareBrowser failure', () => {
  beforeEach((): boolean => {
    LAUNCH_CAMOUFOX_MOCK.mockReset();
    return true;
  });

  it('T-LAUNCH-1 — closes the browser when prepareBrowser rejects', async () => {
    const fake = makeFakeBrowser();
    LAUNCH_CAMOUFOX_MOCK.mockResolvedValue(fake.browser);
    /**
     * Hook that always fails.
     * @returns Rejected promise.
     */
    const prepare = (): Promise<void> => Promise.reject(new Error('prepare boom'));
    const options = makeOptions(prepare);
    const launched = SETUP_MOD.launchBrowser(options);
    await expect(launched).rejects.toThrow('prepare boom');
    const isClosed = fake.wasClosed();
    expect(isClosed).toBe(true);
  });

  it('T-LAUNCH-2 — returns the browser when prepareBrowser resolves', async () => {
    const fake = makeFakeBrowser();
    LAUNCH_CAMOUFOX_MOCK.mockResolvedValue(fake.browser);
    const prepare = jest.fn(async (): Promise<void> => Promise.resolve());
    const options = makeOptions(prepare);
    const launched = await SETUP_MOD.launchBrowser(options);
    const isClosed = fake.wasClosed();
    expect(prepare).toHaveBeenCalledWith(fake.browser);
    expect(launched).toBe(fake.browser);
    expect(isClosed).toBe(false);
  });

  it('T-LAUNCH-3 — returns the browser when no hook is supplied', async () => {
    const fake = makeFakeBrowser();
    LAUNCH_CAMOUFOX_MOCK.mockResolvedValue(fake.browser);
    const options = makeOptions(undefined);
    const launched = await SETUP_MOD.launchBrowser(options);
    const isClosed = fake.wasClosed();
    expect(launched).toBe(fake.browser);
    expect(isClosed).toBe(false);
  });
});
