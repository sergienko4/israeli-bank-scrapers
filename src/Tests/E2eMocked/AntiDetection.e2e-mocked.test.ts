import { type Browser } from 'playwright-core';

import { buildContextOptions } from '../../Common/Browser.js';
import { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from '../../Common/Config/BrowserConfig.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Browser context options (Camoufox)', () => {
  it('sets Hebrew locale and Israel timezone', () => {
    const opts = buildContextOptions();
    expect(opts.locale).toBe(ISRAEL_LOCALE);
    expect(opts.timezoneId).toBe(ISRAEL_TIMEZONE);
  });

  it('applies locale to browser context', async () => {
    const contextOpts = buildContextOptions();
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    try {
      await page.goto('about:blank');
      const lang = await page.evaluate(() => navigator.language);
      expect(lang).toBe(ISRAEL_LOCALE);
    } finally {
      await context.close();
    }
  });
});
