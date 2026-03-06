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

describe('Amex: Mocked E2E', () => {
  it('completes full scrape lifecycle', async () => {
    /** Default mock Amex route fixtures for the full lifecycle test. */
    const routes = amexRoutes();
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts all network requests and serves mock Amex API fixtures.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, routes);
        },
    });

    const result = await scraper.scrape(CREDS);
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();
    expect(result.accounts?.length).toBeGreaterThan(0);
    expect(result.accounts?.[0].accountNumber).toBe('4580-1234');
    expect(result.accounts?.[0].txns.length).toBeGreaterThan(0);
  }, 60000);

  it('detects WAF block when validate returns null', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts requests and returns null for ValidateIdData to simulate a WAF block.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: loadFixture('amex/login-page.html'),
            },
            {
              match: 'reqName=ValidateIdData',
              method: 'POST',
              contentType: 'application/json',
              body: 'null',
            },
          ]);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('WAF block');
  }, 60000);

  it('detects invalid password', async () => {
    /** Routes with login status 9 to simulate invalid-password response. */
    const routes = amexRoutes({ login: JSON.stringify({ status: '9' }) });
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts requests and returns login status 9 to trigger invalid-password detection.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, routes);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  }, 60000);

  it('detects change password required (returnCode=4)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage:
        /**
         * Intercepts requests and returns returnCode 4 to trigger change-password detection.
         *
         * @param page - the Playwright page to attach route interception to
         */
        async page => {
          await setupRequestInterception(page, [
            {
              match: '/personalarea/Login',
              contentType: 'text/html',
              body: loadFixture('amex/login-page.html'),
            },
            {
              match: 'reqName=ValidateIdData',
              method: 'POST',
              contentType: 'application/json',
              body: JSON.stringify({
                Header: { Status: '1' },
                ValidateIdDataBean: { returnCode: '4', userName: 'TestUser' },
              }),
            },
          ]);
        },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  }, 60000);
});
