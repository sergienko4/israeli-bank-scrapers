import { type Browser } from 'playwright';

import { buildContextOptions } from '../../Helpers/Browser';
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
      expect(ua).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
      expect(ua).not.toContain('HeadlessChrome');
    } finally {
      await context.close();
    }
  });

  it('sets Hebrew language preferences', async () => {
    const context = await browser.newContext(buildContextOptions());
    const page = await context.newPage();
    try {
      await page.goto('about:blank');
      const language = await page.evaluate(() => navigator.language);
      expect(language).toBe('he-IL');
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
      await page.evaluate(() => fetch('https://test-endpoint.example.com').catch(() => {}));
      expect(capturedHeaders['sec-ch-ua-platform']).toBe('"Windows"');
      expect(capturedHeaders['sec-ch-ua-mobile']).toBe('?0');
    } finally {
      await context.close();
    }
  });
});
