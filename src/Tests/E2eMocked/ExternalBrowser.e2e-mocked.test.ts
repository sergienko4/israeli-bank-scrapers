import { type Browser, type Page } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { createScraper } from '../../Index';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import amexRoutes from './Helpers/AmexRoutes';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture';
import { setupRequestInterception } from './Helpers/RequestInterceptor';

const CREDS = { id: '123456789', card6Digits: '123456', password: 'testpass' };

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('External Browser: Mocked E2E', () => {
  it('uses provided browser instance and does not close it', async () => {
    /** Routes for the shared-browser lifecycle test. */
    const routes = amexRoutes();
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Sets up request interception with mock Amex routes.
         *
         * @param page - the Playwright page to attach route interception to
         * @returns a resolved IDoneResult after interception is set up
         */
        async page => {
          await setupRequestInterception(page, routes);
          return { done: true };
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);

    // Browser should still be usable after scrape
    const page = await browser.newPage();
    expect(page).toBeDefined();
    await page.close();
  }, 60000);

  it('uses provided browser context', async () => {
    const context = await browser.newContext();
    /** Routes for the browser-context test. */
    const routes = amexRoutes();
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browserContext: context,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Sets up request interception with mock Amex routes for the browser context test.
         *
         * @param page - the Playwright page to attach route interception to
         * @returns a resolved IDoneResult after interception is set up
         */
        async page => {
          await setupRequestInterception(page, routes);
          return { done: true };
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);

    // Context should still be usable
    const page = await context.newPage();
    expect(page).toBeDefined();
    await page.close();
    await context.close();
  }, 60000);

  it('can run multiple sequential scrapes with shared browser', async () => {
    /** Routes shared across sequential scrape runs. */
    const routes = amexRoutes();
    const options = {
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Sets up request interception for each sequential scrape run.
         *
         * @param page - the Playwright page to attach route interception to
         * @returns a resolved IDoneResult after interception is set up
         */
        async (page: Page): Promise<IDoneResult> => {
          await setupRequestInterception(page, routes);
          return { done: true };
        },
    };

    const result1 = await createScraper(options).scrape(CREDS);
    expect(result1.success).toBe(true);

    const result2 = await createScraper(options).scrape(CREDS);
    expect(result2.success).toBe(true);
  }, 120000);
});
