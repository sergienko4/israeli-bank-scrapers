import { faker } from '@faker-js/faker';

import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { waitUntil } from '../../Common/Waiting';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import HapoalimScraper from '../../Scrapers/Hapoalim/HapoalimScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { HEBREW_TRANSACTION_TYPES } from '../HebrewBankingFixtures';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  BrowserEngineType: {
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://login.bankhapoalim.co.il/portalserver/HomePage'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Waiting', () => ({
  waitUntil: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
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
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('../../Common/OtpHandler', () => ({ handleOtpStep: jest.fn().mockResolvedValue(null) }));

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { userCode: 'user123', password: 'pass456' };

interface HapoalimScrapedTxn {
  serialNumber: number;
  activityDescription?: string;
  eventAmount: number;
  eventDate: string;
  valueDate: string;
  referenceNumber?: number;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: Record<string, string | undefined>;
}

/**
 * Creates a mock page configured for Hapoalim scraper tests.
 *
 * @returns a mock page with evaluate mocked for bnhpApp and restContext
 */
function createHapoalimPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest
      .fn()
      .mockResolvedValueOnce(true) // waitUntil → bnhpApp exists
      .mockResolvedValueOnce('/api/v1'), // getRestContext → restContext
    cookies: jest.fn().mockResolvedValue([{ name: 'XSRF-TOKEN', value: 'xsrf-token-value' }]),
  });
}

/**
 * Sets up fetchGetWithinPage to return account list data for Hapoalim tests.
 *
 * @param accounts - the list of accounts to return in the mock response
 */
function mockAccounts(
  accounts: {
    bankNumber: string;
    branchNumber: string;
    accountNumber: string;
    accountClosingReasonCode: number;
  }[] = [],
): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(accounts);
}

/**
 * Sets up fetchGetWithinPage to return a balance for Hapoalim tests.
 *
 * @param balance - the current balance to return in the mock response
 */
function mockBalance(balance = 10000): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ currentBalance: balance });
}

/**
 * Sets up fetchPostWithinPage to return transaction data for Hapoalim tests.
 *
 * @param txns - the transactions to include in the mock response
 */
function mockTransactions(txns: HapoalimScrapedTxn[] = []): void {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ transactions: txns });
}

/**
 * Creates a mock HapoalimScrapedTxn with randomized defaults.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a HapoalimScrapedTxn for testing
 */
function scrapedTxn(overrides: Partial<HapoalimScrapedTxn> = {}): HapoalimScrapedTxn {
  return {
    serialNumber: faker.number.int({ min: 1, max: 9999 }),
    activityDescription: faker.helpers.arrayElement([...HEBREW_TRANSACTION_TYPES]),
    eventAmount: faker.number.float({ min: 10, max: 5000, fractionDigits: 2 }),
    eventDate: '20240615',
    valueDate: '20240616',
    referenceNumber: faker.number.int({ min: 10000, max: 999999 }),
    eventActivityTypeCode: 2,
    currentBalance: faker.number.float({ min: 1000, max: 100000, fractionDigits: 2 }),
    pfmDetails: '/pfm/details?id=1',
    ...overrides,
  };
}

/**
 * Sets up the mock page, context, and account data for a full Hapoalim login+scrape test.
 *
 * @param accounts - the accounts to configure in the mock
 * @returns the configured mock page
 */
function setupLoginAndAccounts(
  accounts: {
    bankNumber: string;
    branchNumber: string;
    accountNumber: string;
    accountClosingReasonCode: number;
  }[] = [
    { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
  ],
): ReturnType<typeof createMockPage> {
  const page = createHapoalimPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  (waitUntil as jest.Mock).mockImplementation(async (fn: () => Promise<boolean>) => {
    await fn();
  });
  mockAccounts(accounts);
  return page;
}

beforeEach(() => {
  faker.seed(42);
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createHapoalimPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://login.bankhapoalim.co.il/portalserver/HomePage',
  );
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword for error URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false',
    );
    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword for password expiry URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/MCP/START?flow=MCP&state=START&expiredDate=null',
    );
    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches transactions for open accounts', async () => {
    setupLoginAndAccounts();
    mockBalance(15000);
    mockTransactions([scrapedTxn({ eventAmount: 250, activityDescription: 'קניה' })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('12-345-678');
    expect((result.accounts ?? [])[0].balance).toBe(15000);

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.description).toBe('קניה');
    expect(t.originalCurrency).toBe('ILS');
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.originalAmount).toBe(-250);
  });

  it('negates outbound transactions (eventActivityTypeCode=2)', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ eventActivityTypeCode: 2, eventAmount: 300 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].originalAmount).toBe(-300);
  });

  it('keeps inbound transactions positive', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ eventActivityTypeCode: 1, eventAmount: 300 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].originalAmount).toBe(300);
  });

  it('marks pending transactions (serialNumber=0)', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ serialNumber: 0 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('marks completed transactions (serialNumber > 0)', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ serialNumber: 5 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Completed);
  });

  it('constructs memo from beneficiary details', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([
      scrapedTxn({
        beneficiaryDetailsData: {
          partyHeadline: 'Transfer',
          partyName: 'John',
          messageHeadline: 'Rent',
          messageDetail: 'Monthly',
        },
      }),
    ]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].memo).toBe('Transfer John. Rent Monthly.');
  });

  it('filters closed accounts', async () => {
    setupLoginAndAccounts([
      { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
      { bankNumber: '12', branchNumber: '345', accountNumber: '999', accountClosingReasonCode: 1 },
    ]);
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('12-345-678');
  });

  it('uses empty string for missing description', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ activityDescription: undefined })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].description).toBe('');
  });

  it('includes rawTransaction when option set', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });
});
