import { type Browser } from 'puppeteer';
import { applyAntiDetection } from '../../helpers/browser';
import { getSharedBrowser, closeSharedBrowser } from './helpers/browser-fixture';

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Anti-detection verification (real browser)', () => {
  it('hides navigator.webdriver', async () => {
    const page = await browser.newPage();
    try {
      await applyAntiDetection(page);
      await page.goto('about:blank');
      const webdriver = await page.evaluate(() => navigator.webdriver);
      expect(webdriver).toBeFalsy();
    } finally {
      await page.close();
    }
  });

  it('sets realistic user agent with Chrome version', async () => {
    const page = await browser.newPage();
    try {
      await applyAntiDetection(page);
      await page.goto('about:blank');
      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
      expect(ua).not.toContain('HeadlessChrome');
    } finally {
      await page.close();
    }
  });

  it('sets Hebrew language preferences', async () => {
    const page = await browser.newPage();
    try {
      await applyAntiDetection(page);
      await page.goto('about:blank');
      const languages = await page.evaluate(() => Array.from(navigator.languages));
      expect(languages).toContain('he-IL');
      expect(languages).toContain('en-US');
    } finally {
      await page.close();
    }
  });

  it('defines window.chrome object', async () => {
    const page = await browser.newPage();
    try {
      await applyAntiDetection(page);
      await page.goto('about:blank');
      const hasChrome = await page.evaluate(() => !!(window as any).chrome);
      expect(hasChrome).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('sets client hints headers on requests', async () => {
    const page = await browser.newPage();
    try {
      await applyAntiDetection(page);
      await page.setRequestInterception(true);
      let capturedHeaders: Record<string, string> = {};
      page.on('request', request => {
        if (request.url().includes('test-endpoint')) {
          capturedHeaders = request.headers();
        }
        void request.continue();
      });
      await page.goto('about:blank');
      await page.evaluate(() => fetch('https://test-endpoint.example.com').catch(() => {}));
      expect(capturedHeaders['sec-ch-ua-platform']).toBe('"Windows"');
      expect(capturedHeaders['sec-ch-ua-mobile']).toBe('?0');
    } finally {
      await page.close();
    }
  });
});
