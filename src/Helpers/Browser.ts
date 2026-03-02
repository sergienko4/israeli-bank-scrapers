import { type BrowserContextOptions } from 'playwright';

const CHROME_VERSION = '131';
const HEBREW_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults:
 * Hebrew locale, Israel timezone, realistic Chrome UA and client hints.
 */
export function buildContextOptions(viewport?: {
  width: number;
  height: number;
}): BrowserContextOptions {
  return {
    userAgent: HEBREW_UA,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: viewport ?? { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not_A Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  };
}
