import { type Page } from 'puppeteer';

const BOT_DETECTION_PATTERNS = ['detector-dom.min.js', 'detector-dom', 'bot-detect'];

/**
 * Extract major Chrome version from browser version string.
 */
async function getChromeVersion(page: Page): Promise<string> {
  const version = await page.browser().version();
  return version.match(/Chrome\/(\d+)/)?.[1] ?? '131';
}

/**
 * Set realistic User-Agent with dynamic Chrome version.
 */
async function setRealisticUserAgent(page: Page, chromeVersion: string): Promise<void> {
  await page.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`,
  );
}

/**
 * Set HTTP headers that Israeli bank WAFs expect from real browsers.
 * Hebrew locale + client hints matching the dynamic Chrome version.
 */
async function setRealisticHeaders(page: Page, chromeVersion: string): Promise<void> {
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });
}

/**
 * Apply bank-specific anti-detection overrides on top of puppeteer-extra-plugin-stealth.
 *
 * The stealth plugin handles: navigator.webdriver, plugins, chrome object,
 * permissions, WebGL, canvas, iframe prototype chain, etc.
 *
 * This function adds Israeli-bank-specific customizations:
 * - Hebrew-first locale in User-Agent and Accept-Language
 * - Client hints headers matching the actual Chrome version
 */
export async function applyAntiDetection(page: Page): Promise<void> {
  const chromeVersion = await getChromeVersion(page);
  await setRealisticUserAgent(page, chromeVersion);
  await setRealisticHeaders(page, chromeVersion);

  // Override stealth plugin's defaults with Israeli-specific locale and timezone
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
  });
  await page.emulateTimezone('Asia/Jerusalem');
}

/**
 * Check if a URL matches known bot detection scripts.
 */
export function isBotDetectionScript(url: string): boolean {
  return BOT_DETECTION_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Priorities for request interception.
 */
export const interceptionPriorities = {
  abort: 1000,
  continue: 10,
};
