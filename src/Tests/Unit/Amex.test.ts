import { jest } from '@jest/globals';

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchPostWithinPage: jest.fn(),
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  humanDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(async (fns: (() => Promise<unknown>)[]) => {
    const results = [];
    for (const fn of fns) results.push(await fn());
    return results;
  }),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.unstable_mockModule('../../Common/Dates.js', () => ({ default: jest.fn(() => []) }));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

const { launchCamoufox } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage, fetchPostWithinPage } = await import('../../Common/Fetch.js');
const { SCRAPERS } = await import('../../Definitions.js');
const { default: AMEXScraper } = await import('../../Scrapers/Amex/AmexScraper.js');
const { LOGIN_RESULTS } = await import('../../Scrapers/Base/BaseScraperWithBrowser.js');
const { createMockPage, createMockScraperOptions } = await import('../MockPage.js');
const { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } =
  await import('../TestsUtils.js');

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
    (launchCamoufox as jest.Mock).mockResolvedValue(mockAmexBrowser);
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
