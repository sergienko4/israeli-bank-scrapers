import { fetchGraphql, fetchPost } from '../../Common/Fetch';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import OneZeroScraper from '../../Scrapers/OneZero/OneZeroScraper';
import { TransactionTypes } from '../../Transactions';
import { createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/Fetch', () => ({
  fetchPost: jest.fn(),
  fetchGraphql: jest.fn(),
}));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
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

/**
 * Sets up fetchPost to return a mock device token response.
 *
 * @param deviceToken - the device token to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockDeviceToken(deviceToken = 'device-123'): IDoneResult {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { deviceToken } });
  return { done: true };
}

/**
 * Sets up fetchPost to return a mock OTP preparation response.
 *
 * @param otpContext - the OTP context string to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockOtpPrepare(otpContext = 'otp-ctx-456'): IDoneResult {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpContext } });
  return { done: true };
}

/**
 * Sets up fetchPost to return a mock OTP verification response with a long-term token.
 *
 * @param otpToken - the long-term OTP token to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockOtpVerify(otpToken = 'otp-long-term-token'): IDoneResult {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpToken } });
  return { done: true };
}

/**
 * Sets up fetchPost to return a mock ID token response.
 *
 * @param idToken - the ID token string to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockIdToken(idToken = 'id-token-789'): IDoneResult {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
  return { done: true };
}

/**
 * Sets up fetchPost to return a mock session token response.
 *
 * @param accessToken - the session access token to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockSessionToken(accessToken = 'access-token-abc'): IDoneResult {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
  return { done: true };
}

/**
 * Sets up the standard ID token and session token mocks for a long-term token login test.
 *
 * @returns a resolved IDoneResult after mocks are configured
 */
function setupLongTermLogin(): IDoneResult {
  mockIdToken();
  mockSessionToken();
  return { done: true };
}

/**
 * Sets up fetchGraphql to return a mock OneZero customer response.
 *
 * @param portfolios - the portfolios to include in the mock customer response
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockCustomer(
  portfolios: {
    portfolioId: string;
    portfolioNum: string;
    accounts: { accountId: string }[];
  }[] = [],
): IDoneResult {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    customer: [{ customerId: 'cust-1', portfolios }],
  });
  return { done: true };
}

/**
 * Sets up fetchGraphql to return a mock OneZero movements page response.
 *
 * @param movements - the movements to include in the mock response
 * @param hasMore - whether there are more pages to fetch
 * @param cursor - the pagination cursor for the next page
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockMovements(
  movements: IOneZeroMovement[] = [],
  hasMore = false,
  cursor = 'next',
): IDoneResult {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    movements: {
      movements,
      pagination: { hasMore, cursor },
    },
  });
  return { done: true };
}

/**
 * Sets up fetchGraphql to return a mock OneZero account balance response.
 *
 * @param currentAccountBalance - the balance amount to return
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockAccountBalance(currentAccountBalance = 5000): IDoneResult {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    balance: {
      currentAccountBalance,
      currentAccountBalanceStr: String(currentAccountBalance),
      blockedAmountStr: '0',
      limitAmountStr: '0',
    },
  });
  return { done: true };
}

/**
 * Returns an ISO date string from approximately one month ago for use in test fixtures.
 *
 * @returns an ISO date string one month before today
 */
function recentDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString();
}

interface IOneZeroMovement {
  movementId: string;
  valueDate: string;
  movementTimestamp: string;
  movementAmount: string;
  movementCurrency: string;
  creditDebit: string;
  description: string;
  runningBalance: string;
  transaction: null | {
    enrichment?: {
      recurrences?: { isRecurrent: boolean; dataSource?: string }[] | null;
    } | null;
  };
  bankCurrencyAmount?: string;
  conversionRate?: string;
  isReversed?: boolean;
  movementReversedId?: string | null;
  movementType?: string;
  portfolioId?: string;
  accountId?: string;
}

/**
 * Creates a mock IOneZeroMovement for unit tests.
 *
 * @param overrides - optional field overrides for the mock movement
 * @returns a IOneZeroMovement object for testing
 */
function movement(overrides: Partial<IOneZeroMovement> = {}): IOneZeroMovement {
  const ts = recentDate();
  return {
    movementId: 'mov-001',
    valueDate: ts.slice(0, 10),
    movementTimestamp: ts,
    movementAmount: '100',
    movementCurrency: 'ILS',
    creditDebit: 'DEBIT',
    description: 'Test Payment',
    runningBalance: '5000',
    transaction: null,
    ...overrides,
  };
}

const LONG_TERM_CREDS = {
  email: 'test@example.com',
  password: 'pass123',
  otpLongTermToken: 'valid-token',
};

const OTP_CALLBACK_CREDS = {
  email: 'test@example.com',
  password: 'pass123',
  otpCodeRetriever: jest.fn().mockResolvedValue('123456'),
  phoneNumber: '+972501234567',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('login', () => {
  it('succeeds with otpLongTermToken', async () => {
    setupLongTermLogin();
    mockCustomer();

    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.success).toBe(true);
    expect(fetchPost).toHaveBeenCalledTimes(2);
  });

  it('succeeds with otpCodeRetriever callback', async () => {
    mockDeviceToken();
    mockOtpPrepare();
    mockOtpVerify();
    mockIdToken();
    mockSessionToken();
    mockCustomer();

    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape(OTP_CALLBACK_CREDS);

    expect(result.success).toBe(true);
    expect(OTP_CALLBACK_CREDS.otpCodeRetriever).toHaveBeenCalled();
    expect(fetchPost).toHaveBeenCalledTimes(5);
  });

  it('returns error for empty otpLongTermToken', async () => {
    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape({
      email: 'test@example.com',
      password: 'pass',
      otpLongTermToken: '',
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toContain('Invalid otpLongTermToken');
  });

  it('returns error when phone number does not start with +', async () => {
    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape({
      email: 'test@example.com',
      password: 'pass',
      otpCodeRetriever: jest.fn(),
      phoneNumber: '0501234567',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('international phone number');
  });
});

describe('fetchData', () => {
  it('fetches portfolio movements', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([movement()]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('ACC-001');
    expect((result.accounts ?? [])[0].txns).toHaveLength(1);

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.originalAmount).toBe(-100);
    expect(t.originalCurrency).toBe('ILS');
    expect(t.description).toBe('Test Payment');
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('negates DEBIT amounts', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([movement({ movementAmount: '200', creditDebit: 'DEBIT' })]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].txns[0].chargedAmount).toBe(-200);
  });

  it('keeps CREDIT amounts positive', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([movement({ movementAmount: '300', creditDebit: 'CREDIT' })]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].txns[0].chargedAmount).toBe(300);
  });

  it('detects installments from recurrences enrichment', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([
      movement({
        transaction: {
          enrichment: {
            recurrences: [{ dataSource: 'test', isRecurrent: true }],
          },
        },
      }),
    ]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].txns[0].type).toBe(TransactionTypes.Installments);
  });

  it('paginates through multiple pages', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    const recentTs = recentDate();
    const olderTs = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    mockMovements(
      [movement({ movementTimestamp: recentTs, movementId: 'mov-2' })],
      true,
      'cursor-2',
    );
    mockMovements([movement({ movementTimestamp: olderTs, movementId: 'mov-1' })], false);
    mockAccountBalance(5000);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(2);
    expect(fetchGraphql).toHaveBeenCalledTimes(4); // customer + 2 movements pages + balance
  });
});
