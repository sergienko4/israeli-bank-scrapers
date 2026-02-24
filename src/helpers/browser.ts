import { type Page } from 'puppeteer';

const BOT_DETECTION_PATTERNS = ['detector-dom.min.js', 'detector-dom', 'bot-detect'];

/**
 * Inject JS overrides that hide headless Chrome fingerprints.
 */
async function applyStealthScript(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(window, 'chrome', { get: () => ({ runtime: {} }) });
    const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    Object.defineProperty(window.navigator.permissions, 'query', {
      value: (params: PermissionDescriptor) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : origQuery(params),
    });
  });
}

/**
 * Set realistic User-Agent with dynamic Chrome version.
 */
async function setRealisticUserAgent(page: Page): Promise<void> {
  const version = await page.browser().version();
  const major = version.match(/Chrome\/(\d+)/)?.[1] ?? '131';
  await page.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
  );
}

/**
 * Set HTTP headers that WAFs expect from real browsers.
 */
async function setRealisticHeaders(page: Page): Promise<void> {
  const version = await page.browser().version();
  const major = version.match(/Chrome\/(\d+)/)?.[1] ?? '131';
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });
}

/**
 * Apply full anti-detection suite to hide headless Chrome from WAFs.
 * Call BEFORE any navigation — overrides run on every new page load.
 */
export async function applyAntiDetection(page: Page): Promise<void> {
  await applyStealthScript(page);
  await setRealisticUserAgent(page);
  await setRealisticHeaders(page);
}

/**
 * Check if a URL matches known bot detection scripts.
 */
export function isBotDetectionScript(url: string): boolean {
  return BOT_DETECTION_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * @deprecated Use applyAntiDetection() instead.
 */
export async function maskHeadlessUserAgent(page: Page): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.setUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/'));
}

/**
 * Priorities for request interception.
 */
export const interceptionPriorities = {
  abort: 1000,
  continue: 10,
};
