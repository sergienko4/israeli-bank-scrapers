import { type Browser } from 'playwright';

import { launchCamoufox } from '../../../Common/CamoufoxLauncher';

let sharedBrowser: Browser | null = null;

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
