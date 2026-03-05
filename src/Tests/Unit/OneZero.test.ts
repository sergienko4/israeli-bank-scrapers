import { fetchGraphql, fetchPost } from '../../Common/Fetch';
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
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

function mockDeviceToken(deviceToken = 'device-123'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { deviceToken } });
}

function mockOtpPrepare(otpContext = 'otp-ctx-456'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpContext } });
}

function mockOtpVerify(otpToken = 'otp-long-term-token'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpToken } });
}

function mockIdToken(idToken = 'id-token-789'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
}

function mockSessionToken(accessToken = 'access-token-abc'): void {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
}

function setupLongTermLogin(): void {
  mockIdToken();
  mockSessionToken();
}

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

function mockMovements(movements: OneZeroMovement[] = [], hasMore = false, cursor = 'next'): void {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    movements: {
      movements,
      pagination: { hasMore, cursor },
    },
  });
}

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

function recentDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString();
}

interface OneZeroMovement {
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
