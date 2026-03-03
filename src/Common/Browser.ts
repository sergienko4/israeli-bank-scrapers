import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { type BrowserContextOptions } from 'playwright';

interface PlaywrightBrowsersJson {
  browsers: { name: string; browserVersion: string }[];
}

function detectChromeVersion(): string {
  try {
    const pkgPath = require.resolve('playwright-core/package.json');
    const browsersPath = join(dirname(pkgPath), 'browsers.json');
    const data = JSON.parse(readFileSync(browsersPath, 'utf8')) as PlaywrightBrowsersJson;
    const chromium = data.browsers.find(b => b.name === 'chromium');
    if (chromium) return chromium.browserVersion.split('.')[0];
  } catch {
    /* fall through to default */
  }
  return '145';
}

const CHROME_VERSION = detectChromeVersion();
const HEBREW_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/**
 * Build Playwright browser context options with Israeli bank-friendly defaults:
 * Hebrew locale, Israel timezone, realistic Chrome UA and client hints.
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    userAgent: HEBREW_UA,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not_A Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  };
}
