import { type BrowserContextOptions } from 'playwright';

/** Default timezone for Israeli bank portals. */
export const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Camoufox handles UA, viewport, screen, and client hints at the C++ level,
 * so we only need locale and timezone here.
 * @returns BrowserContextOptions configured for Israeli locale and timezone.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    javaScriptEnabled: true,
  };
}
