import { type Browser } from 'playwright';

import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';

let sharedBrowser: Browser | null = null;

/** E2eMocked tests use Camoufox — same engine as production. */
export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await launchCamoufox(true);
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
