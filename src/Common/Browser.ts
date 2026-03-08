import { type BrowserContextOptions } from 'playwright';

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults.
 * Camoufox handles UA, viewport, screen, and client hints at the C++ level,
 * so we only need locale and timezone here.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    javaScriptEnabled: true,
  };
}
