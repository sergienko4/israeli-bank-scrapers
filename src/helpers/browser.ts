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
 * Lightweight stealth overrides that bypass Cloudflare without triggering
 * detection of puppeteer-extra-plugin-stealth's proxy-based patterns.
 */
async function applyStealthOverrides(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
    // @ts-expect-error -- chrome.runtime stub to appear as real Chrome
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });
}

/**
 * Apply anti-detection overrides for Israeli bank scrapers.
 *
 * Uses lightweight manual stealth instead of puppeteer-extra-plugin-stealth,
 * which Cloudflare detects via its proxy-based iframe.contentWindow patterns.
 */
export async function applyAntiDetection(page: Page): Promise<void> {
  const chromeVersion = await getChromeVersion(page);
  await setRealisticUserAgent(page, chromeVersion);
  await setRealisticHeaders(page, chromeVersion);
  await applyStealthOverrides(page);
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
