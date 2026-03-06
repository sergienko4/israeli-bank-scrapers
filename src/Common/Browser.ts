import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { type BrowserContextOptions } from 'playwright';

interface PlaywrightBrowsersJson {
  browsers: { name: string; browserVersion: string }[];
}

/**
 * Reads the bundled Playwright browsers.json to detect the pinned Chromium major version.
 * Falls back to '145' when the file cannot be read (e.g. in environments without playwright-core).
 *
 * @returns the Chromium major version string, e.g. '124'
 */
function detectChromeVersion(): string {
  try {
    const pkgPath = require.resolve('playwright-core/package.json');
    const playwrightCoreDir = dirname(pkgPath);
    const browsersPath = join(playwrightCoreDir, 'browsers.json');
    const fileContent = readFileSync(browsersPath, 'utf8');
    const data = JSON.parse(fileContent) as PlaywrightBrowsersJson;
    const chromium = data.browsers.find(b => b.name === 'chromium');
    if (chromium) {
      const versionParts = chromium.browserVersion.split('.');
      return versionParts[0];
    }
  } catch {
    /* fall through to default */
  }
  return '145';
}

const CHROME_VERSION = detectChromeVersion();
const UA_BASE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
const HEBREW_UA = `${UA_BASE} Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/**
 * Assembles the HTTP request headers that mimic a genuine Israeli Chrome browser session,
 * including Accept-Language, Sec-CH-UA client-hint fields, and Sec-Fetch-* navigation hints.
 *
 * @returns a map of HTTP header name to value
 */
function buildClientHintHeaders(): Record<string, string> {
  return {
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Builds Playwright browser context options configured for Israeli bank sites:
 * Hebrew locale, Israel timezone, a realistic Chrome user-agent, and client-hint headers.
 *
 * @returns a BrowserContextOptions object ready to pass to browser.newContext()
 */
export function buildContextOptions(): BrowserContextOptions {
  return {
    userAgent: HEBREW_UA,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1.25,
    javaScriptEnabled: true,
    hasTouch: false,
    extraHTTPHeaders: buildClientHintHeaders(),
  };
}

export default buildContextOptions;
