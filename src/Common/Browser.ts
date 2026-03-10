import { type BrowserContextOptions } from 'playwright';

/** Default timezone for Israeli bank portals. */
export const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Camoufox handles UA, screen, and client hints at the C++ level.
 * Viewport is set explicitly to ensure consistent rendering across CI and local.
 * @returns BrowserContextOptions configured for Israeli locale, timezone, and viewport.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    javaScriptEnabled: true,
    viewport: { width: 1920, height: 1280 },
  };
}
