import type { Browser } from 'playwright';

import { ISRAEL_LOCALE } from './Config/BrowserConfig.js';

/** Default locale for Camoufox browser instances. */
export const CAMOUFOX_LOCALE = ISRAEL_LOCALE;

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
    locale: CAMOUFOX_LOCALE,
  }) as unknown as Browser;
}
