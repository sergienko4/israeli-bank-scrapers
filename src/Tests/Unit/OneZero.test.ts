import { jest } from '@jest/globals';

import type { IOneZeroMovement } from './OneZeroFixtures.js';

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mock Fetch.
   * @returns Mocked module.
   */
  () => ({ fetchPost: jest.fn(), fetchGraphql: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mock Transactions.
   * @returns Mocked module.
   */
  () => ({
    getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug.
   * @returns Mocked module.
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns Mock logger.
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
  }),
);

const { fetchGraphql: FETCH_GRAPHQL, fetchPost: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: ONE_ZERO_SCRAPER } = await import('../../Scrapers/OneZero/OneZeroScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./OneZeroFixtures.js');

/**
 * Mock the device token API response.
 * @param deviceToken - Device token value.
 * @returns True when setup complete.
 */
function mockDeviceToken(deviceToken = 'device-123'): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { deviceToken } });
  return true;
}

/**
 * Mock the OTP prepare API response.
 * @param otpContext - OTP context value.
 * @returns True when setup complete.
 */
function mockOtpPrepare(otpContext = 'otp-ctx-456'): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { otpContext } });
  return true;
}

/**
 * Mock the OTP verify API response.
 * @param otpToken - OTP token value.
 * @returns True when setup complete.
 */
function mockOtpVerify(otpToken = 'otp-long-term-token'): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { otpToken } });
  return true;
}

/**
 * Mock the ID token API response.
 * @param idToken - ID token value.
 * @returns True when setup complete.
 */
function mockIdToken(idToken = 'id-token-789'): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
  return true;
}

/**
 * Mock the session token API response.
 * @param accessToken - Access token value.
 * @returns True when setup complete.
 */
function mockSessionToken(accessToken = 'access-token-abc'): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
  return true;
}

/**
 * Set up mocks for a long-term token login flow.
 * @returns True when setup complete.
 */
function setupLongTermLogin(): boolean {
  mockIdToken();
  mockSessionToken();
  return true;
}

interface IPortfolio {
  portfolioId: string;
  portfolioNum: string;
  accounts: { accountId: string }[];
}

/**
 * Mock the customer API response with portfolios.
 * @param portfolios - Portfolio list.
 * @returns True when setup complete.
 */
function mockCustomer(portfolios: IPortfolio[] = []): boolean {
  (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
    customer: [{ customerId: 'cust-1', portfolios }],
  });
  return true;
}

/**
 * Mock the movements API response.
 * @param movements - Movement list.
 * @param hasMore - Whether more pages exist.
 * @param cursor - Pagination cursor.
 * @returns True when setup complete.
 */
function mockMovements(
  movements: IOneZeroMovement[] = [],
  hasMore = false,
  cursor = 'next',
): boolean {
  (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
    movements: { movements, pagination: { hasMore, cursor } },
  });
  return true;
}

/**
 * Mock the account balance API response.
 * @param currentAccountBalance - Balance value.
 * @returns True when setup complete.
 */
function mockAccountBalance(currentAccountBalance = 5000): boolean {
  (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
    balance: {
      currentAccountBalance,
      currentAccountBalanceStr: String(currentAccountBalance),
      blockedAmountStr: '0',
      limitAmountStr: '0',
    },
  });
  return true;
}

const SINGLE_PORTFOLIO: IPortfolio[] = [
  { portfolioId: 'port-1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'acc-1' }] },
];

beforeEach(
  /**
   * Clear mocks before each test.
   * @returns Test setup flag.
   */
  () => {
    jest.clearAllMocks();
    return true;
  },
);

describe('login', () => {
  it('succeeds with otpLongTermToken', async () => {
    setupLongTermLogin();
    mockCustomer();
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(FETCH_POST).toHaveBeenCalledTimes(2);
  });

  it('succeeds with otpCodeRetriever callback', async () => {
    mockDeviceToken();
    mockOtpPrepare();
    mockOtpVerify();
    mockIdToken();
    mockSessionToken();
    mockCustomer();
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.OTP_CALLBACK_CREDS);
    expect(result.success).toBe(true);
    expect(FIXTURES.OTP_CALLBACK_CREDS.otpCodeRetriever).toHaveBeenCalled();
    expect(FETCH_POST).toHaveBeenCalledTimes(5);
  });

  it('returns error for empty otpLongTermToken', async () => {
    const creds = { email: 'test@example.com', password: 'pass', otpLongTermToken: '' };
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(creds);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.Generic);
    expect(result.errorMessage).toContain('Invalid otpLongTermToken');
  });

  it('returns error when phone number does not start with +', async () => {
    const creds = {
      email: 'test@example.com',
      password: 'pass',
      otpCodeRetriever: jest.fn(),
      phoneNumber: '0501234567',
    };
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(creds);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('international phone number');
  });
});

describe('fetchData', () => {
  it('fetches portfolio movements', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement();
    mockMovements([mov]);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    const account = result.accounts?.[0];
    expect(account?.accountNumber).toBe('ACC-001');
    expect(account?.txns).toHaveLength(1);
    const txn = account?.txns[0];
    expect(txn?.originalAmount).toBe(-100);
    expect(txn?.originalCurrency).toBe('ILS');
    expect(txn?.type).toBe(TX_TYPES.Normal);
  });

  it('negates DEBIT amounts', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement({ movementAmount: '200', creditDebit: 'DEBIT' });
    mockMovements([mov]);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.txns[0]?.chargedAmount).toBe(-200);
  });

  it('keeps CREDIT amounts positive', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement({ movementAmount: '300', creditDebit: 'CREDIT' });
    mockMovements([mov]);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.txns[0]?.chargedAmount).toBe(300);
  });

  it('detects installments from recurrences enrichment', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement({
      transaction: {
        enrichment: { recurrences: [{ dataSource: 'test', isRecurrent: true }] },
      },
    });
    mockMovements([mov]);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.txns[0]?.type).toBe(TX_TYPES.Installments);
  });

  it('handles empty portfolios', async () => {
    setupLongTermLogin();
    mockCustomer([]);
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('extracts balance from balance query', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement({
      runningBalance: '9000',
      movementTimestamp: '2024-06-15T10:00:00Z',
    });
    mockMovements([mov]);
    mockAccountBalance(10000);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.balance).toBe(10000);
  });

  it('sets all transactions as Completed', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement();
    mockMovements([mov]);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.txns[0]?.status).toBe(TX_STATUSES.Completed);
  });

  it('handles multiple portfolios', async () => {
    setupLongTermLogin();
    mockCustomer([
      { portfolioId: 'p1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'a1' }] },
      { portfolioId: 'p2', portfolioNum: 'ACC-002', accounts: [{ accountId: 'a2' }] },
    ]);
    const mov1 = FIXTURES.movement({ description: 'Txn1' });
    const mov2 = FIXTURES.movement({ description: 'Txn2' });
    mockMovements([mov1]);
    mockAccountBalance(3000);
    mockMovements([mov2]);
    mockAccountBalance(4000);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts?.[0]?.accountNumber).toBe('ACC-001');
    expect(result.accounts?.[1]?.accountNumber).toBe('ACC-002');
  });

  it('handles movement with zero balance', async () => {
    setupLongTermLogin();
    const singlePort: IPortfolio[] = [
      { portfolioId: 'p1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'a1' }] },
    ];
    mockCustomer(singlePort);
    const mov = FIXTURES.movement({ runningBalance: '0' });
    mockMovements([mov]);
    mockAccountBalance(0);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.accounts?.[0]?.balance).toBe(0);
  });
});
