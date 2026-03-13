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
  runSerial: jest.fn((fns: (() => Promise<string>)[]) => {
    const emptyArray: string[] = [];
    const initialValue = Promise.resolve(emptyArray);
    return fns.reduce(async (accPromise: Promise<string[]>, funcItem: () => Promise<string>) => {
      const accumulated = await accPromise;
      const funcResult = await funcItem();
      return [...accumulated, funcResult];
    }, initialValue);
  }),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

jest.unstable_mockModule('../../Common/Dates.js', () => ({ default: jest.fn(() => []) }));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: string[]) => txns),
  filterOldTransactions: jest.fn((txns: string[]) => txns),
  getRawTransaction: jest.fn((data: Record<string, string>) => data),
}));

const CAMOUFOX_MOD = await import('../../Common/CamoufoxLauncher.js');
const FETCH_MOD = await import('../../Common/Fetch.js');
const DEFINITIONS_MOD = await import('../../Definitions.js');
const AMEX_MOD = await import('../../Scrapers/Amex/AmexScraper.js');
const BASE_SCRAPER_MOD = await import('../../Scrapers/Base/BaseScraperWithBrowser.js');
const MOCK_PAGE_MOD = await import('../MockPage.js');
const TESTS_UTILS_MOD = await import('../TestsUtils.js');

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
 * Sets up mock responses for the Amex login flow.
 * @returns The configured mock for chaining.
 */
function mockAmexLogin(): jest.Mock {
  return (FETCH_MOD.fetchPostWithinPage as jest.Mock)
    .mockResolvedValueOnce({
      Header: { Status: '1' },
      ValidateIdDataBean: { returnCode: '1', userName: 'testuser' },
    })
    .mockResolvedValueOnce({ status: '1' });
}

const COMPANY_ID = 'amex';
const TESTS_CONFIG = TESTS_UTILS_MOD.getTestsConfig();

describe('AMEX fetchData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CAMOUFOX_MOD.launchCamoufox as jest.Mock).mockResolvedValue(MOCK_AMEX_BROWSER);
    const mockPage = MOCK_PAGE_MOD.createMockPage();
    MOCK_AMEX_CONTEXT.newPage.mockResolvedValue(mockPage);
  });

  it('handles empty month response — returns accounts[]', async () => {
    mockAmexLogin();
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValue(null);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new AMEX_MOD.default(options);
    const result = await scraper.scrape(AMEX_CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('AMEX legacy scraper', () => {
  beforeAll(() => {
    TESTS_UTILS_MOD.extendAsyncTimeout();
  });

  test('should expose login fields in scrapers constant', () => {
    expect(DEFINITIONS_MOD.SCRAPERS.amex).toBeDefined();
    expect(DEFINITIONS_MOD.SCRAPERS.amex.loginFields).toContain('id');
    expect(DEFINITIONS_MOD.SCRAPERS.amex.loginFields).toContain('card6Digits');
    expect(DEFINITIONS_MOD.SCRAPERS.amex.loginFields).toContain('password');
  });

  TESTS_UTILS_MOD.maybeTestCompanyAPI(
    COMPANY_ID,
    config => config.companyAPI.invalidPassword === true,
  )('should fail on invalid user/password"', async () => {
    const options = {
      ...TESTS_CONFIG.options,
      companyId: COMPANY_ID,
    };

    const scraper = new AMEX_MOD.default(options as ScraperOptions);

    const result = await scraper.scrape({
      id: 'e10s12',
      card6Digits: '123456',
      password: '3f3ss3d',
    });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(BASE_SCRAPER_MOD.LOGIN_RESULTS.InvalidPassword);
  });

  TESTS_UTILS_MOD.maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...TESTS_CONFIG.options,
      companyId: COMPANY_ID,
    };

    const scraper = new AMEX_MOD.default(options as ScraperOptions);
    const result = await scraper.scrape(
      TESTS_CONFIG.credentials.amex as unknown as Parameters<typeof scraper.scrape>[0],
    );
    expect(result).toBeDefined();
    const errorType = result.errorType ?? '';
    const errorMessage = result.errorMessage ?? '';
    const error = `${errorType} ${errorMessage}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    const accounts = result.accounts ?? [];
    TESTS_UTILS_MOD.exportTransactions(COMPANY_ID, accounts);
  });
});
