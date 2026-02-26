import { type Browser } from 'puppeteer';
import { CompanyTypes } from '../../definitions';
import { createScraper } from '../../index';
import { ScraperErrorTypes } from '../../scrapers/errors';
import { getSharedBrowser, closeSharedBrowser } from './helpers/browser-fixture';
import { setupRequestInterception } from './helpers/request-interceptor';

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
      companyId: CompanyTypes.amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 10000,
      navigationRetryCount: 0,
      preparePage: async page => {
        await setupRequestInterception(page, [
          { match: '/personalarea/Login', contentType: 'text/html', body: 'Server Error', status: 500 },
        ]);
      },
    });

    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  }, 60000);

  it('handles validate returning invalid response', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 10000,
      preparePage: async page => {
        await setupRequestInterception(page, [
          { match: '/personalarea/Login', contentType: 'text/html', body: '<html><body>Login</body></html>' },
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
