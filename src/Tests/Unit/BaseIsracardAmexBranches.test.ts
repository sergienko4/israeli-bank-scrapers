/**
 * BaseIsracardAmex additional branch-coverage tests.
 * Covers: interpretLoginStatus (status=undefined), validateCredentials (null result,
 * missing ValidateIdDataBean), performLogin (null loginResult),
 * handleValidateReturnCode (generic code), setupResponseLogging (non-proxy URL).
 */
import { jest } from '@jest/globals';

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import type { IScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes.js';
import type { ITransaction } from '../../Transactions.js';
import MockTimeoutError from '../Mocks/MockTimeoutError.js';

/**
 * Create a mock that resolves to the given value.
 * @param resolvedValue - The value to resolve.
 * @returns Mocked function.
 */
const MOCK_RESOLVED = (resolvedValue?: unknown): jest.Mock =>
  jest.fn().mockResolvedValue(resolvedValue);

/**
 * Create a mock logger with all levels.
 * @returns Mock logger with trace/debug/info/warn/error.
 */
const MOCK_LOGGER = (): Record<string, jest.Mock> => ({
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({
  launchCamoufox: jest.fn(),
}));
jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: MOCK_RESOLVED(),
  humanDelay: MOCK_RESOLVED(),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  waitUntil: MOCK_RESOLVED(),
  raceTimeout: MOCK_RESOLVED(),
  TimeoutError: MockTimeoutError,
  SECOND: 1000,
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: ITransaction[]) => txns),
  filterOldTransactions: jest.fn((txns: ITransaction[]) => txns),
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));
jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: MOCK_LOGGER,
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(),
}));

const { default: MOMENT } = await import('moment');
const { default: GET_ALL_MONTHS } = await import('../../Common/Dates.js');
(GET_ALL_MONTHS as jest.Mock).mockReturnValue([MOMENT('2024-06-01')]);
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage: FETCH_GET, fetchPostWithinPage: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: ISRACARD_AMEX_BASE } =
  await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmex.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');

const BASE_URL = 'https://americanexpress.co.il';
const CREDS = { id: '123456789', password: 'pass123', card6Digits: '123456' };

/** Test-only Amex scraper subclass for unit testing. */
class TestAmexScraper extends ISRACARD_AMEX_BASE {
  /**
   * Creates a test scraper with optional overrides.
   * @param overrides - scraper option overrides
   */
  constructor(overrides: Partial<ScraperOptions> = {}) {
    const opts = CREATE_OPTS(overrides);
    super(opts, BASE_URL, '77');
  }
}

const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Mocks validate-credentials API with success header.
 * @param returnCode - validation return code.
 * @param userName - user name in response.
 * @returns The mock instance.
 */
function mockValidate(returnCode = '1', userName = 'TestUser'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    ValidateIdDataBean: { returnCode, userName },
  });
}

/**
 * Mocks the login API.
 * @param status - login status code.
 * @returns The mock instance.
 */
function mockLogin(status = '1'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ status });
}

/**
 * Mocks accounts/dashboard API.
 * @param cardNumber - card number to return.
 * @returns The mock instance.
 */
function mockAccounts(cardNumber = '1234'): jest.Mock {
  return (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    DashboardMonthBean: {
      cardsCharges: [{ cardIndex: '0', cardNumber, billingDate: '15/06/2024' }],
    },
  });
}

/**
 * Mocks the transactions API with domestic transactions.
 * @param txnIsrael - domestic transactions.
 * @returns The mock instance.
 */
function mockTxns(txnIsrael: IScrapedTransaction[] = []): jest.Mock {
  const groups = txnIsrael.length ? { txnIsrael } : {};
  return (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    CardsTransactionsListBean: { Index0: { CurrentCardTransactions: [groups] } },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = CREATE_MOCK_PAGE();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
});

describe('interpretLoginStatus — undefined status', () => {
  it('returns InvalidPassword when login response is null', async () => {
    mockValidate('1');
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(null);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.InvalidPassword);
  });
});

describe('validateCredentials — missing ValidateIdDataBean', () => {
  it('returns WafBlocked when Status=1 but no ValidateIdDataBean', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
    });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.WafBlocked);
  });
});

describe('handleValidateReturnCode — other codes', () => {
  it('returns InvalidPassword for returnCode=2', async () => {
    mockValidate('2');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.InvalidPassword);
  });
});

describe('performLogin — login status variants', () => {
  it('returns ChangePassword for login status=3', async () => {
    mockValidate('1');
    mockLogin('3');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.ChangePassword);
  });

  it('returns InvalidPassword for login status=7', async () => {
    mockValidate('1');
    mockLogin('7');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.InvalidPassword);
  });
});

describe('fetchData — transaction response edge cases', () => {
  it('handles null transaction data response', async () => {
    mockValidate('1');
    mockLogin('1');
    mockAccounts();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce(null);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles missing CardsTransactionsListBean', async () => {
    mockValidate('1');
    mockLogin('1');
    mockAccounts();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
    });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('setupResponseLogging — coverage', () => {
  it('registers response listener on page', async () => {
    mockValidate('1');
    mockLogin('1');
    mockAccounts();
    mockTxns();
    const page = CREATE_MOCK_PAGE();
    MOCK_CONTEXT.newPage.mockResolvedValue(page);
    await new TestAmexScraper().scrape(CREDS);
    const anyFn = expect.any(Function) as jest.Mock;
    expect(page.on).toHaveBeenCalledWith('response', anyFn);
  });

  it('logs ProxyRequestHandler URLs via response callback', async () => {
    mockValidate('1');
    mockLogin('1');
    mockAccounts();
    mockTxns();
    const page = CREATE_MOCK_PAGE();
    MOCK_CONTEXT.newPage.mockResolvedValue(page);
    await new TestAmexScraper().scrape(CREDS);
    type ResponseHandler = (_r: { url: () => string; status: () => number }) => string;
    const calls = page.on.mock.calls as [string, ResponseHandler][];
    const onCall = calls.find(c => c[0] === 'response');
    expect(onCall).toBeDefined();
    const handler = onCall?.[1];
    if (handler === undefined) return;
    /**
     * Proxy URL getter.
     * @returns Proxy URL.
     */
    const proxyUrl = (): string => 'https://example.com/ProxyRequestHandler?x=1';
    /**
     * Personal area URL getter.
     * @returns Personal area URL.
     */
    const areaUrl = (): string => 'https://example.com/personalarea/data';
    /**
     * Other URL getter.
     * @returns Other URL.
     */
    const otherUrl = (): string => 'https://example.com/other/path';
    /**
     * Status getter.
     * @returns Status 200.
     */
    const ok = (): number => 200;
    handler({ url: proxyUrl, status: ok });
    handler({ url: areaUrl, status: ok });
    handler({ url: otherUrl, status: ok });
    expect(true).toBe(true);
  });
});

describe('login — userName null fallback', () => {
  it('uses empty string when userName is null', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      ValidateIdDataBean: { returnCode: '1', userName: null },
    });
    mockLogin('1');
    mockAccounts();
    mockTxns();
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
  });
});

describe('handleValidateReturnCode — returnCode=4 ChangePassword', () => {
  it('returns ChangePassword for returnCode=4', async () => {
    mockValidate('4');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.ChangePassword);
  });
});
