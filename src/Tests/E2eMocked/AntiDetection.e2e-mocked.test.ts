import { type Browser } from 'playwright';

import { buildContextOptions } from '../../Common/Browser';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture';

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Playwright context options verification (real browser)', () => {
  it('sets realistic user agent with Chrome version', async () => {
    const context = await browser.newContext(buildContextOptions());
    const page = await context.newPage();
    try {
      await page.goto('about:blank');
      const ua = await page.evaluate(() => navigator.userAgent);
      // Stealth plugin uses real Chromium build number (e.g. 145.0.7632.6)
      expect(ua).toMatch(/Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/537\.36$/);
      expect(ua).not.toContain('HeadlessChrome');
    } finally {
      await context.close();
    }
  });

  it('sets Hebrew Accept-Language header', async () => {
    const context = await browser.newContext(buildContextOptions());
    const page = await context.newPage();
    try {
      let capturedHeaders: Record<string, string> = {};
      await page.route('**/*', async (route, request) => {
        if (request.url().includes('test-endpoint')) {
          capturedHeaders = request.headers();
        }
        await route.continue();
      });
      await page.goto('about:blank');
      // Stealth plugin may override navigator.language, but the HTTP header
      // is what Israeli banks check — our extraHTTPHeaders always set it.
      await page.evaluate(() =>
        fetch('https://test-endpoint.example.com').catch(() => {
          /* no-op */
        }),
      );
      expect(capturedHeaders['accept-language']).toMatch(/he-IL/);
    } finally {
      await context.close();
    }
  });

  it('sets client hints headers on requests', async () => {
    const context = await browser.newContext(buildContextOptions());
    const page = await context.newPage();
    try {
      let capturedHeaders: Record<string, string> = {};
      await page.route('**/*', async (route, request) => {
        if (request.url().includes('test-endpoint')) {
          capturedHeaders = request.headers();
        }
        await route.continue();
      });
      await page.goto('about:blank');
      await page.evaluate(() =>
        fetch('https://test-endpoint.example.com').catch(() => {
          /* no-op */
        }),
      );
      expect(capturedHeaders['sec-ch-ua-platform']).toBe('"Windows"');
      expect(capturedHeaders['sec-ch-ua-mobile']).toBe('?0');
    } finally {
      await context.close();
    }
  });
});
