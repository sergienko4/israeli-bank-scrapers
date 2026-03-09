import { SCRAPERS } from '../../Definitions.js';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import OtsarHahayalScraper from '../../Scrapers/OtsarHahayal/OtsarHahayalScraper.js';
import {
  exportTransactions,
  extendAsyncTimeout,
  getTestsConfig,
  maybeTestCompanyAPI,
} from '../TestsUtils.js';

const COMPANY_ID = 'otsarHahayal';
const TESTS_CONFIG = getTestsConfig();

describe('OtsarHahayal legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.otsarHahayal).toBeDefined();
    expect(SCRAPERS.otsarHahayal.loginFields).toContain('username');
    expect(SCRAPERS.otsarHahayal.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword === true)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...TESTS_CONFIG.options,
        companyId: COMPANY_ID,
      };

      const scraper = new OtsarHahayalScraper(options as unknown as ScraperOptions);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LOGIN_RESULTS.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...TESTS_CONFIG.options,
      companyId: COMPANY_ID,
    };

    const scraper = new OtsarHahayalScraper(options as unknown as ScraperOptions);
    const result = await scraper.scrape(
      TESTS_CONFIG.credentials.otsarHahayal as unknown as Parameters<typeof scraper.scrape>[0],
    );
    expect(result).toBeDefined();
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts ?? []);
  });
});
