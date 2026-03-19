import { type BrowserContextOptions } from 'playwright-core';

import { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

export { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Viewport is fixed at 1920×1080 to ensure desktop layout — Israeli banking sites
 * hide login buttons and show different HTML on smaller/mobile viewports.
 * @returns BrowserContextOptions configured for Israeli locale, timezone, and desktop viewport.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: ISRAEL_LOCALE,
    timezoneId: ISRAEL_TIMEZONE,
    javaScriptEnabled: true,
    viewport: { width: 1920, height: 1080 },
  };
}
