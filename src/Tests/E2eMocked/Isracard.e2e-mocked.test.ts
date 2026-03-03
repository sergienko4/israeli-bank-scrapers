import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { createScraper } from '../../index';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import { amexRoutes } from './Helpers/AmexRoutes';
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
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage: async page => {
        await setupRequestInterception(page, amexRoutes());
      },
    });

    const result = await scraper.scrape(CREDS);
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();
    expect(result.accounts!.length).toBeGreaterThan(0);
    expect(result.accounts![0].txns.length).toBeGreaterThan(0);
  }, 60000);

  it('detects invalid password', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage: async page => {
        await setupRequestInterception(
          page,
          amexRoutes({ login: JSON.stringify({ status: '9' }) }),
        );
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
      preparePage: async page => {
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
});
