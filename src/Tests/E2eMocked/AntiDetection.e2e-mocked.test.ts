import { type Browser } from 'playwright';

import { buildContextOptions } from '../../Common/Browser.js';
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
    expect(opts.locale).toBe('he-IL');
    expect(opts.timezoneId).toBe('Asia/Jerusalem');
  });

  it('applies locale to browser context', async () => {
    const context = await browser.newContext(buildContextOptions());
    const page = await context.newPage();
    try {
      await page.goto('about:blank');
      const lang = await page.evaluate(() => navigator.language);
      expect(lang).toBe('he-IL');
    } finally {
      await context.close();
    }
  });
});
