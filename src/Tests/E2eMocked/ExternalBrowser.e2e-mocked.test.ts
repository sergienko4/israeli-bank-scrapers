import { type Browser, type Page } from 'playwright';
import { CompanyTypes } from '../../Definitions';
import { createScraper } from '../../index';
import { getSharedBrowser, closeSharedBrowser } from './Helpers/BrowserFixture';
import { setupRequestInterception } from './Helpers/RequestInterceptor';
import { amexRoutes } from './Helpers/AmexRoutes';

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
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage: async page => {
        await setupRequestInterception(page, amexRoutes());
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

    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browserContext: context,
      defaultTimeout: 15000,
      preparePage: async page => {
        await setupRequestInterception(page, amexRoutes());
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
    const options = {
      companyId: CompanyTypes.Amex,
      startDate: new Date('2026-01-01'),
      browser,
      skipCloseBrowser: true,
      defaultTimeout: 15000,
      preparePage: async (page: Page) => {
        await setupRequestInterception(page, amexRoutes());
      },
    };

    const result1 = await createScraper(options).scrape(CREDS);
    expect(result1.success).toBe(true);

    const result2 = await createScraper(options).scrape(CREDS);
    expect(result2.success).toBe(true);
  }, 120000);
});
