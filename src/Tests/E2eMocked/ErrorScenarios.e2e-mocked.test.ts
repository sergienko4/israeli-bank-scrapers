import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { createScraper } from '../../Index';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
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

describe('Error Scenarios: Mocked E2E', () => {
  it('handles login page returning HTTP 500', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 10000,
      navigationRetryCount: 0,
      preparePage:
        /**
         * Serves a 500 error for the login page to simulate a server failure.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: 'Server Error',
              status: 500,
            },
          ]);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  }, 60000);

  it('handles validate network error (fetch throws inside page.evaluate)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 10000,
      preparePage:
        /**
         * Aborts the ValidateIdData request to simulate a network error inside page.evaluate.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: '<html><body>Login</body></html>',
            },
            { match: 'reqName=ValidateIdData', method: 'POST', abort: true },
          ]);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeTruthy();
    expect(result.errorMessage).toMatch(/fetchPostWithinPage error/);
  }, 60000);

  it('handles validate returning invalid response', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 10000,
      preparePage:
        /**
         * Returns a validate response with Status 0 to trigger WAF-blocked detection.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: '<html><body>Login</body></html>',
            },
            {
              match: 'reqName=ValidateIdData',
              method: 'POST',
              contentType: 'application/json',
              body: JSON.stringify({ Header: { Status: '0' } }),
            },
          ]);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.suggestions.length).toBeGreaterThan(0);
  }, 60000);
});
