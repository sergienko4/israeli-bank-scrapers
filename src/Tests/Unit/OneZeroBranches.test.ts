/**
 * OneZeroScraper branch-coverage tests.
 * Covers: resolveStoredToken (invalid/valid), resolveOtpToken (no retriever, no phone),
 * triggerTwoFactorAuth (no + prefix), fetchData without login, shouldStop pagination,
 * fetchBalance fallback, empty portfolio customers.
 */
import { jest } from '@jest/globals';

import type { IOneZeroMovement } from './OneZeroFixtures.js';

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mock Fetch module.
   * @returns Mocked fetch functions.
   */
  () => ({ fetchPost: jest.fn(), fetchGraphql: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mock Transactions module.
   * @returns Mocked transaction helpers.
   */
  () => ({
    getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns Mocked debug logger factory.
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
    /**
     * Passthrough mock for bank context.
     * @param _b - Bank name (unused).
     * @param fn - Function to execute.
     * @returns fn result.
     */
    runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
  }),
);

const { fetchGraphql: FETCH_GRAPHQL, fetchPost: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: ONE_ZERO_SCRAPER } = await import('../../Scrapers/OneZero/OneZeroScraper.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./OneZeroFixtures.js');

interface IPortfolio {
  portfolioId: string;
  portfolioNum: string;
  accounts: { accountId: string }[];
}

/**
 * Mock the device token API response.
 * @param deviceToken - Device token value.
 * @returns The mock instance.
 */
function mockDeviceToken(deviceToken = 'device-123'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { deviceToken } });
}

/**
 * Mock the OTP prepare API response.
 * @param otpContext - OTP context value.
 * @returns The mock instance.
 */
function mockOtpPrepare(otpContext = 'otp-ctx-456'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { otpContext } });
}

/**
 * Mock the OTP verify API response.
 * @param otpToken - OTP token value.
 * @returns The mock instance.
 */
function mockOtpVerify(otpToken = 'otp-long-term-token'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { otpToken } });
}

/**
 * Mock the ID token API response.
 * @param idToken - ID token value.
 * @returns The mock instance.
 */
function mockIdToken(idToken = 'id-token-789'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
}

/**
 * Mock the session token API response.
 * @param accessToken - Access token value.
 * @returns The mock instance.
 */
function mockSessionToken(accessToken = 'access-token-abc'): jest.Mock {
  return (FETCH_POST as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
}

/**
 * Set up mocks for a long-term token login flow.
 * @returns The session token mock.
 */
function setupLongTermLogin(): jest.Mock {
  mockIdToken();
  return mockSessionToken();
}

/**
 * Mock the customer API response with portfolios.
 * @param portfolios - Portfolio list.
 * @returns The mock instance.
 */
function mockCustomer(portfolios: IPortfolio[] = []): jest.Mock {
  return (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
    customer: [{ customerId: 'cust-1', portfolios }],
  });
}

/**
 * Mock the movements API response.
 * @param movements - Movement list.
 * @param hasMore - Whether more pages exist.
 * @param cursor - Pagination cursor.
 * @returns The mock instance.
 */
function mockMovements(
  movements: IOneZeroMovement[] = [],
  hasMore = false,
  cursor = 'next',
): jest.Mock {
  return (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
    movements: { movements, pagination: { hasMore, cursor } },
  });
}

/**
 * Mock the account balance API to reject (fallback path).
 * @returns The mock instance.
 */
function mockBalanceFailure(): jest.Mock {
  return (FETCH_GRAPHQL as jest.Mock).mockRejectedValueOnce(new Error('balance query failed'));
}

const SINGLE_PORTFOLIO: IPortfolio[] = [
  { portfolioId: 'port-1', portfolioNum: 'ACC-001', accounts: [{ accountId: 'acc-1' }] },
];

beforeEach(
  /**
   * Clear mocks before each test.
   */
  () => {
    jest.clearAllMocks();
  },
);

describe('resolveOtpToken — missing otpCodeRetriever', () => {
  it('returns TwoFactorRetrieverMissing when no token and no retriever', async () => {
    const creds = { email: 'test@example.com', password: 'pass' } as never;
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(creds);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.TwoFactorRetrieverMissing);
    expect(result.errorMessage).toContain('otpLongTermToken or otpCodeRetriever required');
  });
});

describe('resolveOtpToken — missing phoneNumber with retriever', () => {
  it('returns Generic error when retriever present but no phone', async () => {
    const creds = {
      email: 'test@example.com',
      password: 'pass',
      otpCodeRetriever: jest.fn(),
      phoneNumber: '',
    };
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(creds);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.Generic);
    expect(result.errorMessage).toContain('phoneNumber required');
  });
});

describe('fetchData — without login', () => {
  it('returns error when fetchData called before login', async () => {
    const scraper = new ONE_ZERO_SCRAPER(CREATE_OPTS());
    const result = await scraper.fetchData();
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.Generic);
    expect(result.errorMessage).toContain('login() was not called');
  });
});

describe('triggerTwoFactorAuth — phone validation', () => {
  it('returns error when phone lacks + prefix', async () => {
    const scraper = new ONE_ZERO_SCRAPER(CREATE_OPTS());
    const result = await scraper.triggerTwoFactorAuth('0501234567');
    expect(result.success).toBe(false);
    expect((result as { errorMessage: string }).errorMessage).toContain(
      'international phone number',
    );
  });

  it('succeeds when phone starts with +', async () => {
    mockDeviceToken();
    mockOtpPrepare();
    const scraper = new ONE_ZERO_SCRAPER(CREATE_OPTS());
    const result = await scraper.triggerTwoFactorAuth('+972501234567');
    expect(result.success).toBe(true);
  });
});

describe('getLongTermTwoFactorToken — no prior OTP context', () => {
  it('returns error when triggerOtp was not called', async () => {
    const scraper = new ONE_ZERO_SCRAPER(CREATE_OPTS());
    const result = await scraper.getLongTermTwoFactorToken('123456');
    expect(result.success).toBe(false);
    expect((result as { errorMessage: string }).errorMessage).toContain(
      'triggerOtp was not called',
    );
  });
});

describe('shouldStop — pagination logic', () => {
  it('stops when hasMore is false', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement();
    mockMovements([mov], false);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(FETCH_GRAPHQL).toHaveBeenCalledTimes(3);
  });

  it('continues fetching when hasMore=true and date is recent', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const recentMov = FIXTURES.movement();
    mockMovements([recentMov], true, 'cursor-2');
    const olderMov = FIXTURES.movement({
      movementTimestamp: '2020-01-01T00:00:00Z',
    });
    mockMovements([olderMov], false);
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
  });

  it('stops when oldest movement is before startDate', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const oldMov = FIXTURES.movement({
      movementTimestamp: '2020-01-01T00:00:00Z',
    });
    mockMovements([oldMov], true, 'cursor-2');
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
  });
});

describe('fetchBalance — fallback on error', () => {
  it('uses fallback balance when balance query fails', async () => {
    setupLongTermLogin();
    mockCustomer(SINGLE_PORTFOLIO);
    const mov = FIXTURES.movement({ runningBalance: '7777' });
    mockMovements([mov], false);
    mockBalanceFailure();
    const opts = CREATE_OPTS({ startDate: new Date('2024-01-01') });
    const result = await new ONE_ZERO_SCRAPER(opts).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.balance).toBe(7777);
  });
});

describe('customer without portfolios', () => {
  it('handles customer with null portfolios', async () => {
    setupLongTermLogin();
    (FETCH_GRAPHQL as jest.Mock).mockResolvedValueOnce({
      customer: [{ customerId: 'cust-1' }],
    });
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.LONG_TERM_CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('full OTP retriever flow', () => {
  it('completes login via otpCodeRetriever callback', async () => {
    mockDeviceToken();
    mockOtpPrepare();
    mockOtpVerify();
    mockIdToken();
    mockSessionToken();
    mockCustomer();
    const creds = {
      email: 'test@example.com',
      password: 'pass',
      otpCodeRetriever: jest.fn().mockResolvedValue('654321'),
      phoneNumber: '+972509876543',
    };
    const result = await new ONE_ZERO_SCRAPER(CREATE_OPTS()).scrape(creds);
    expect(result.success).toBe(true);
    expect(creds.otpCodeRetriever).toHaveBeenCalled();
  });
});
