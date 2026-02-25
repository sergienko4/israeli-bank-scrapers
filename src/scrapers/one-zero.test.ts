import { fetchPost, fetchGraphql } from '../helpers/fetch';
import { createMockScraperOptions } from '../tests/mock-page';
import OneZeroScraper from './one-zero';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('../helpers/fetch', () => ({
  fetchPost: jest.fn(),
  fetchGraphql: jest.fn(),
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

function mockDeviceToken(deviceToken = 'device-123') {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { deviceToken } });
}

function mockOtpPrepare(otpContext = 'otp-ctx-456') {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpContext } });
}

function mockOtpVerify(otpToken = 'otp-long-term-token') {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { otpToken } });
}

function mockIdToken(idToken = 'id-token-789') {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { idToken } });
}

function mockSessionToken(accessToken = 'access-token-abc') {
  (fetchPost as jest.Mock).mockResolvedValueOnce({ resultData: { accessToken } });
}

function setupLongTermLogin() {
  mockIdToken();
  mockSessionToken();
}

function mockCustomer(portfolios: any[] = []) {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    customer: [{ customerId: 'cust-1', portfolios }],
  });
}

function mockMovements(movements: any[] = [], hasMore = false, cursor = 'next') {
  (fetchGraphql as jest.Mock).mockResolvedValueOnce({
    movements: {
      movements,
      pagination: { hasMore, cursor },
    },
  });
}

function recentDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString();
}

function movement(overrides: any = {}): any {
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

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('ACC-001');
    expect(result.accounts![0].txns).toHaveLength(1);
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

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns[0].chargedAmount).toBe(-200);
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

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns[0].chargedAmount).toBe(300);
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

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns[0].type).toBe(TransactionTypes.Installments);
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
    mockMovements([movement({ movementTimestamp: recentTs, movementId: 'mov-2' })], true, 'cursor-2');
    mockMovements([movement({ movementTimestamp: olderTs, movementId: 'mov-1' })], false);

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns).toHaveLength(2);
    expect(fetchGraphql).toHaveBeenCalledTimes(3); // customer + 2 movements pages
  });

  it('handles empty portfolios', async () => {
    setupLongTermLogin();
    mockCustomer([]);

    const scraper = new OneZeroScraper(createMockScraperOptions());
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('extracts balance from last movement', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([movement({ runningBalance: '10000', movementTimestamp: '2024-06-15T10:00:00Z' })]);

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].balance).toBe(10000);
  });

  it('includes rawTransaction when option set', async () => {
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
      createMockScraperOptions({ startDate: new Date('2024-01-01'), includeRawTransaction: true }),
    );
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('sets all transactions as Completed', async () => {
    setupLongTermLogin();
    mockCustomer([
      {
        portfolioId: 'port-1',
        portfolioNum: 'ACC-001',
        accounts: [{ accountId: 'acc-1' }],
      },
    ]);
    mockMovements([movement()]);

    const scraper = new OneZeroScraper(createMockScraperOptions({ startDate: new Date('2024-01-01') }));
    const result = await scraper.scrape(LONG_TERM_CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Completed);
  });
});
