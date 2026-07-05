import { type BrowserContextOptions } from 'playwright-core';

import { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './BrowserConfig.js';

export { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './BrowserConfig.js';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Viewport is left `null` so the render surface follows the Camoufox-pinned
 * 1920×1080 launch window (see `CamoufoxLauncher.buildLaunchOptions`) — Israeli
 * banking sites hide login buttons and serve mobile HTML on smaller viewports,
 * and a fixed Playwright `viewport` makes `newContext` emit a
 * `Browser.setDefaultViewport` command Camoufox's Firefox does not implement
 * (breaks on playwright-core ≥ 1.61).
 * @returns BrowserContextOptions configured for Israeli locale, timezone, and the Camoufox window size.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: ISRAEL_LOCALE,
    timezoneId: ISRAEL_TIMEZONE,
    javaScriptEnabled: true,
    viewport: null,
  };
}
