import { type BrowserContextOptions } from 'playwright-core';

import { DEFAULT_VIEWPORT, ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

export { DEFAULT_VIEWPORT, ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Camoufox handles UA, screen, and client hints at the C++ level.
 * Viewport is a fixed 1920×1080 from BrowserConfig — required by banks that hide login at smaller sizes.
 * @returns BrowserContextOptions configured for Israeli locale and timezone.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: ISRAEL_LOCALE,
    timezoneId: ISRAEL_TIMEZONE,
    javaScriptEnabled: true,
    viewport: DEFAULT_VIEWPORT,
  };
}
