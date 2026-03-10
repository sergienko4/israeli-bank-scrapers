import { type Browser, type BrowserContext } from 'playwright';

import { buildContextOptions } from '../../../Common/Browser.js';
import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';

let sharedBrowser: Browser | null = null;

/**
 * E2eMocked tests use Camoufox — same engine as production.
 * @returns The shared browser instance.
 */
export async function getSharedBrowser(): Promise<Browser> {
  sharedBrowser ??= await launchCamoufox(true);
  return sharedBrowser;
}

/**
 * Create an isolated BrowserContext for a single test.
 * Each context has its own routes, cookies, and storage — no leaking between parallel tests.
 * @returns A new isolated BrowserContext.
 */
export async function createIsolatedContext(): Promise<BrowserContext> {
  const browser = await getSharedBrowser();
  const contextOptions = buildContextOptions();
  return browser.newContext(contextOptions);
}

/**
 * Close the shared browser and reset state.
 * @returns True after browser is closed.
 */
export async function closeSharedBrowser(): Promise<boolean> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
  return true;
}
