import type { Browser } from 'playwright-core';

import { DESKTOP_VIEWPORT_HEIGHT, DESKTOP_VIEWPORT_WIDTH, ISRAEL_LOCALE } from './BrowserConfig.js';

export { ISRAEL_LOCALE } from './BrowserConfig.js';

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because camoufox-js is ESM-only.
 *
 * Pins os/window/screen to a deterministic Windows 1920x1080 fingerprint
 * so banks cannot serve mobile content via screen-size heuristics. Without
 * this, Camoufox randomly picks per launch and an unlucky fingerprint can
 * trip the bank's mobile detection (observed: Isracard post-login splash
 * to /Sta… mobile-app upsell on small-screen fingerprint).
 *
 * Camoufox's `screen` option is a constraint pair (min/max); setting min
 * equal to max forces the exact desktop dimensions every run.
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  return camoufoxModule.Camoufox({
    headless,
    locale: ISRAEL_LOCALE,
    os: 'windows',
    window: [DESKTOP_VIEWPORT_WIDTH, DESKTOP_VIEWPORT_HEIGHT],
    screen: {
      minWidth: DESKTOP_VIEWPORT_WIDTH,
      maxWidth: DESKTOP_VIEWPORT_WIDTH,
      minHeight: DESKTOP_VIEWPORT_HEIGHT,
      maxHeight: DESKTOP_VIEWPORT_HEIGHT,
    },
  });
}
