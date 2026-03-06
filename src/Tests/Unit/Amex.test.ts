import { chromium } from 'playwright-extra';

import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { SCRAPERS } from '../../Definitions';
import AMEXScraper from '../../Scrapers/Amex/AmexScraper';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import { createMockPage, createMockScraperOptions } from '../MockPage';
import {
  exportTransactions,
  extendAsyncTimeout,
  getTestsConfig,
  maybeTestCompanyAPI,
} from '../TestsUtils';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/Fetch', () => ({
  fetchPostWithinPage: jest.fn(),
  fetchGetWithinPage: jest.fn(),
}));
jest.mock('../../Common/Browser', () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }));
jest.mock('../../Common/Waiting', () => ({
  humanDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const initialResult: Promise<T[]> = Promise.resolve([]);
    return actions.reduce(
      (p: Promise<T[]>, a: () => Promise<T>) => p.then(async (r: T[]) => [...r, await a()]),
      initialResult,
    );
  }),
}));
jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.mock('../../Common/Dates', () => jest.fn(() => []));
jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

const AMEX_CREDS = { id: '123456789', card6Digits: '123456', password: 'pass' };

const MOCK_AMEX_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_AMEX_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_AMEX_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Configures fetchPostWithinPage mocks for a successful Amex login sequence.
 */
function mockAmexLogin(): void {
  (fetchPostWithinPage as jest.Mock)
    .mockResolvedValueOnce({
      Header: { Status: '1' },
      ValidateIdDataBean: { returnCode: '1', userName: 'testuser' },
    })
    .mockResolvedValueOnce({ status: '1' });
}

const COMPANY_ID = 'amex';
const TESTS_CONFIG = getTestsConfig();

describe('AMEX fetchData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chromium.launch as jest.Mock).mockResolvedValue(MOCK_AMEX_BROWSER);
    const freshPage = createMockPage();
    MOCK_AMEX_CONTEXT.newPage.mockResolvedValue(freshPage);
  });

  it('handles empty month response — returns accounts[]', async () => {
    mockAmexLogin();
    (fetchGetWithinPage as jest.Mock).mockResolvedValue(null);

    const scraper = new AMEXScraper(createMockScraperOptions());
    const result = await scraper.scrape(AMEX_CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('AMEX legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.amex).toBeDefined();
    expect(SCRAPERS.amex.loginFields).toContain('id');
    expect(SCRAPERS.amex.loginFields).toContain('card6Digits');
    expect(SCRAPERS.amex.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...TESTS_CONFIG.options,
        companyId: COMPANY_ID,
      };

      const scraper = new AMEXScraper(options as unknown as ScraperOptions);

      const result = await scraper.scrape({
        id: 'e10s12',
        card6Digits: '123456',
        password: '3f3ss3d',
      });

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

    const scraper = new AMEXScraper(options as unknown as ScraperOptions);
    const result = await scraper.scrape(
      TESTS_CONFIG.credentials.amex as Parameters<typeof scraper.scrape>[0],
    );
    expect(result).toBeDefined();
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts ?? []);
  });
});
