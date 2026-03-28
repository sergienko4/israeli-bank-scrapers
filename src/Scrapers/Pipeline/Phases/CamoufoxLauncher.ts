import type { Browser } from 'playwright-core';

import { ISRAEL_LOCALE } from './BrowserConfig.js';

export { ISRAEL_LOCALE } from './BrowserConfig.js';

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because camoufox-js is ESM-only.
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  return camoufoxModule.Camoufox({
    headless,
    locale: ISRAEL_LOCALE,
  }) as unknown as Browser;
}
