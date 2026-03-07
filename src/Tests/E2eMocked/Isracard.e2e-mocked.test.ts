import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { createScraper } from '../../Index';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import amexRoutes from './Helpers/AmexRoutes';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture';
import { loadFixture, setupRequestInterception } from './Helpers/RequestInterceptor';

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
    /** Default mock Amex routes for the full Isracard lifecycle test. */
    const routes = amexRoutes();
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts all network requests and serves mock Amex/Isracard API fixtures.
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
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();
    expect(result.accounts?.length).toBeGreaterThan(0);
    expect(result.accounts?.[0].txns.length).toBeGreaterThan(0);
  }, 60000);

  it('detects invalid password', async () => {
    /** Routes with login status 9 to simulate invalid-password response. */
    const routes = amexRoutes({ login: JSON.stringify({ status: '9' }) });
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts requests with login status 9 to trigger invalid-password detection.
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
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  }, 60000);

  it('detects WAF block when validate returns null', async () => {
    /** Login page HTML fixture for WAF block test. */
    const loginPageHtml = loadFixture('amex/login-page.html');
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Returns null for ValidateIdData to simulate a WAF block.
         *
         * @param page - the Playwright page to attach route interception to
         * @returns a resolved IDoneResult after interception is set up
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: loginPageHtml,
            },
            {
              match: 'reqName=ValidateIdData',
              method: 'POST',
              contentType: 'application/json',
              body: 'null',
            },
          ]);
          return { done: true };
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('WAF block');
  }, 60000);
});
