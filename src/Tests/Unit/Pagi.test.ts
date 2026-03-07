import { SCRAPERS } from '../../Definitions';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import PagiScraper from '../../Scrapers/Pagi/PagiScraper';
import {
  exportTransactions,
  extendAsyncTimeout,
  getTestsConfig,
  maybeTestCompanyAPI,
} from '../TestsUtils';

const COMPANY_ID = 'pagi';
const TESTS_CONFIG = getTestsConfig();

describe('Pagi legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });
  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.pagi).toBeDefined();
    expect(SCRAPERS.pagi.loginFields).toContain('username');
    expect(SCRAPERS.pagi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => Boolean(config.companyAPI.invalidPassword))(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...TESTS_CONFIG.options,
        companyId: COMPANY_ID,
      };

      const scraper = new PagiScraper(options as unknown as ScraperOptions);

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

    const scraper = new PagiScraper(options as unknown as ScraperOptions);
    const result = await scraper.scrape(
      TESTS_CONFIG.credentials.pagi as Parameters<typeof scraper.scrape>[0],
    );
    expect(result).toBeDefined();
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts ?? []);
  });
});
