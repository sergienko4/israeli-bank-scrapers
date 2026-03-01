import { chromium } from 'playwright';

import { SCRAPERS } from '../Definitions';
import { fetchGetWithinPage, fetchPostWithinPage } from '../Helpers/Fetch';
import { createMockPage, createMockScraperOptions } from '../Tests/MockPage';
import {
  exportTransactions,
  extendAsyncTimeout,
  getTestsConfig,
  maybeTestCompanyAPI,
} from '../Tests/TestsUtils';
import AMEXScraper from './Amex';
import { LOGIN_RESULTS } from './BaseScraperWithBrowser';
import type { ScraperOptions } from './Interface';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../Helpers/Fetch', () => ({
  fetchPostWithinPage: jest.fn(),
  fetchGetWithinPage: jest.fn(),
}));
jest.mock('../Helpers/Browser', () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }));
jest.mock('../Helpers/Waiting', () => ({
  humanDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(async (fns: (() => Promise<unknown>)[]) => {
    const results = [];
    for (const fn of fns) results.push(await fn());
    return results;
  }),
}));
jest.mock('../Helpers/Debug', () => ({ getDebug: () => jest.fn() }));
jest.mock('../Helpers/Dates', () => jest.fn(() => []));
jest.mock('../Helpers/Transactions', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

const AMEX_CREDS = { id: '123456789', card6Digits: '123456', password: 'pass' };

const mockAmexContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockAmexBrowser = {
  newContext: jest.fn().mockResolvedValue(mockAmexContext),
  close: jest.fn().mockResolvedValue(undefined),
};

function mockAmexLogin(): void {
  (fetchPostWithinPage as jest.Mock)
    .mockResolvedValueOnce({
      Header: { Status: '1' },
      ValidateIdDataBean: { returnCode: '1', userName: 'testuser' },
    })
    .mockResolvedValueOnce({ status: '1' });
}

const COMPANY_ID = 'amex'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('AMEX fetchData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chromium.launch as jest.Mock).mockResolvedValue(mockAmexBrowser);
    mockAmexContext.newPage.mockResolvedValue(createMockPage());
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
        ...testsConfig.options,
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
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new AMEXScraper(options as unknown as ScraperOptions);
    const result = await scraper.scrape(
      testsConfig.credentials.amex as Parameters<typeof scraper.scrape>[0],
    );
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
