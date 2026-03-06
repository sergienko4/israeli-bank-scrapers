import { fetchGraphql, fetchPost } from '../../Common/Fetch';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import OneZeroScraper from '../../Scrapers/OneZero/OneZeroScraper';
import { TransactionStatuses } from '../../Transactions';
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

interface OneZeroMovement {
  movementId: string;
  valueDate: string;
  movementTimestamp: string;
  movementAmount: string;
  movementCurrency: string;
  creditDebit: string;
  description: string;
  runningBalance: string;
  transaction: null;
}

/**
 * Returns an ISO date string from approximately one month ago.
 *
 * @returns an ISO date string one month before today
 */
function recentDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString();
}

/**
 * Creates a mock OneZeroMovement for extra OneZero unit tests.
 *
 * @param overrides - optional field overrides for the mock movement
 * @returns a OneZeroMovement object for testing
 */
function movement(overrides: Partial<OneZeroMovement> = {}): OneZeroMovement {
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

/**
 * Sets up fetchPost to return a mock ID token response.
 *
 * @param idToken - the ID token string to return
 */
function mockIdToken(idToken = 'id-token-789'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
}

/**
 * Sets up fetchPost to return a mock session token response.
 *
 * @param accessToken - the session access token to return
 */
function mockSessionToken(accessToken = 'access-token-abc'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
}

/**
 * Sets up ID token and session token mocks for long-term login tests.
 */
function setupLongTermLogin(): void {
  mockIdToken();
  mockSessionToken();
}

/**
 * Sets up fetchGraphql to return a mock OneZero customer response.
 *
 * @param portfolios - the portfolios to include in the mock customer response
 */
function mockCustomer(
  portfolios: {
    portfolioId: string;
    portfolioNum: string;
    accounts: { accountId: string }[];
  }[] = [],
): void {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    customer: [{ customerId: 'cust-1', portfolios }],
  });
}

/**
 * Sets up fetchGraphql to return a mock OneZero movements page response.
 *
 * @param movements - the movements to include in the mock response
 * @param hasMore - whether there are more pages to fetch
 */
function mockMovements(movements: OneZeroMovement[] = [], hasMore = false): void {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    movements: {
      movements,
      pagination: { hasMore, cursor: 'next' },
    },
  });
}

/**
 * Sets up fetchGraphql to return a mock OneZero account balance response.
 *
 * @param currentAccountBalance - the balance amount to return
 */
function mockAccountBalance(currentAccountBalance = 5000): void {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    balance: {
      currentAccountBalance,
      currentAccountBalanceStr: String(currentAccountBalance),
      blockedAmountStr: '0',
      limitAmountStr: '0',
    },
  });
}

const LONG_TERM_CREDS = {
  email: 'test@example.com',
  password: 'pass123',
  otpLongTermToken: 'valid-token',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchData extra', () => {
  it('handles multiple portfolios', async () => {
    setupLongTermLogin();
    mockCustomer([
      { portfolioId: 'p1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'a1' }] },
      { portfolioId: 'p2', portfolioNum: 'ACC-002', accounts: [{ accountId: 'a2' }] },
    ]);
    mockMovements([movement({ description: 'Txn1' })]);
    mockMovements([movement({ description: 'Txn2' })]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts).toHaveLength(2);
    expect((result.accounts ?? [])[0].accountNumber).toBe('ACC-001');
    expect((result.accounts ?? [])[1].accountNumber).toBe('ACC-002');
  });

  it('handles movement with zero balance', async () => {
    setupLongTermLogin();
    mockCustomer([{ portfolioId: 'p1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'a1' }] }]);
    mockMovements([movement({ runningBalance: '0' })]);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].balance).toBe(0);
  });

  it('sets all transactions as Completed', async () => {
    setupLongTermLogin();
    mockCustomer([{ portfolioId: 'p1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'a1' }] }]);
    mockMovements([movement()]);
    mockAccountBalance(5000);

    const scraper = new OneZeroScraper(
      createMockScraperOptions({ startDate: new Date('2024-01-01') }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Completed);
  });

  it('returns error when missing otpCodeRetriever and no token', async () => {
    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape({
      email: 'test@example.com',
      password: 'pass',
    } as unknown as Parameters<typeof scraper.scrape>[0]);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
  });

  it('returns error when phoneNumber is missing with otpCodeRetriever', async () => {
    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape({
      email: 'test@example.com',
      password: 'pass',
      otpCodeRetriever: jest.fn() as () => Promise<string>,
    } as unknown as Parameters<typeof scraper.scrape>[0]);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('phoneNumber is required');
  });
});
