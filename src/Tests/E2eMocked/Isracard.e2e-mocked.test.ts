import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions.js';
import { createScraper } from '../../index.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import amexRoutes from './Helpers/AmexRoutes.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import { loadFixture, setupRequestInterception } from './Helpers/RequestInterceptor.js';

const CREDS = { id: '123456789', card6Digits: '123456', password: 'testpass' };

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Isracard: Mocked E2E', () => {
  it('completes full scrape lifecycle', async () => {
    const routes = amexRoutes();
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      /**
       * Sets up request interception for the test page.
       * @param page - the Playwright page to configure
       * @returns setup completion promise
       */
      preparePage: async page => {
        await setupRequestInterception(page, routes);
      },
    });

    const result = await scraper.scrape(CREDS);
    const errorType = result.errorType ?? '';
    const errorMessage = result.errorMessage ?? '';
    const error = `${errorType} ${errorMessage}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();
    const accounts = result.accounts ?? [];
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].txns.length).toBeGreaterThan(0);
  }, 60000);

  it('detects invalid password', async () => {
    const invalidLoginRoutes = amexRoutes({ login: JSON.stringify({ status: '9' }) });
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      /**
       * Intercepts requests with invalid password response.
       * @param page - the Playwright page to configure
       * @returns setup completion promise
       */
      preparePage: async page => {
        await setupRequestInterception(page, invalidLoginRoutes);
      },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  }, 60000);

  it('detects WAF block when validate returns null', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      /**
       * Intercepts requests to simulate WAF block.
       * @param page - the Playwright page to configure
       * @returns setup completion promise
       */
      preparePage: async page => {
        const loginFixture = loadFixture('amex/login-page.html');
        await setupRequestInterception(page, [
          {
            match: '/personalarea/Login',
            contentType: 'text/html',
            body: loginFixture,
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
    expect(result.errorMessage).toContain('WAF blocked');
  }, 60000);
});
