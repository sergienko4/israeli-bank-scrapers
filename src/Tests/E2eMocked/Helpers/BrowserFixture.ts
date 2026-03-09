import { type Browser } from 'playwright';

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
