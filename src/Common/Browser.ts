import { type BrowserContextOptions } from 'playwright';

import { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

export { ISRAEL_TIMEZONE } from './Config/BrowserConfig.js';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Camoufox handles UA, viewport, screen, and client hints at the C++ level,
 * so we only need locale and timezone here.
 * @returns BrowserContextOptions configured for Israeli locale and timezone.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: ISRAEL_LOCALE,
    timezoneId: ISRAEL_TIMEZONE,
    javaScriptEnabled: true,
  };
}
