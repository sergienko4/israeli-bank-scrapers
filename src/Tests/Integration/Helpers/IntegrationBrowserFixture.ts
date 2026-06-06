/**
 * IntegrationBrowserFixture — Shared Camoufox browser for the
 * `src/Tests/Integration/` test layer. Mirrors the E2eMocked pattern
 * (separate instance avoids cross-layer state coupling).
 *
 * <p>Tests call `getIntegrationBrowser()` from `beforeAll` and
 * `closeIntegrationBrowser()` from `afterAll`. One browser per Jest
 * worker; per-test pages created on demand.
 */

import type { Browser } from 'playwright-core';

import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';

let sharedBrowser: Browser | null = null;

/**
 * Lazily launch + return the shared Camoufox browser.
 * @returns The shared browser instance.
 */
async function getIntegrationBrowser(): Promise<Browser> {
  sharedBrowser ??= await launchCamoufox(true);
  return sharedBrowser;
}

/**
 * Close the shared browser and reset state for the next test file.
 * @returns True after the browser closes.
 */
async function closeIntegrationBrowser(): Promise<boolean> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
  return true;
}

export { closeIntegrationBrowser, getIntegrationBrowser };
