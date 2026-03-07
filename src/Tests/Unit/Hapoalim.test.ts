import { faker } from '@faker-js/faker';

import { buildContextOptions } from '../../Common/Browser';
import { launchCamoufox } from '../../Common/CamoufoxLauncher';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { waitUntil } from '../../Common/Waiting';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import HapoalimScraper from '../../Scrapers/Hapoalim/HapoalimScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { HEBREW_TRANSACTION_TYPES } from '../HebrewBankingFixtures';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/CamoufoxLauncher', () => ({ launchCamoufox: jest.fn() }));
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
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('../../Common/OtpHandler', () => ({ handleOtpStep: jest.fn().mockResolvedValue(null) }));

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
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

function createHapoalimPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest
      .fn()
      .mockResolvedValueOnce(true) // waitUntil → bnhpApp exists
      .mockResolvedValueOnce('/api/v1'), // getRestContext → restContext
    cookies: jest.fn().mockResolvedValue([{ name: 'XSRF-TOKEN', value: 'xsrf-token-value' }]),
  });
}

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

function mockBalance(balance = 10000): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ currentBalance: balance });
}

function mockTransactions(txns: HapoalimScrapedTxn[] = []): void {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ transactions: txns });
}

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
  mockContext.newPage.mockResolvedValue(page);
  (waitUntil as jest.Mock).mockImplementation(async (fn: () => Promise<boolean>) => {
    await fn();
  });
  mockAccounts(accounts);
  return page;
}

beforeEach(() => {
  faker.seed(42);
  jest.clearAllMocks();
  (launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createHapoalimPage());
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
    expect(result.accounts![0].accountNumber).toBe('12-345-678');
    expect(result.accounts![0].balance).toBe(15000);

    const t = result.accounts![0].txns[0];
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

    expect(result.accounts![0].txns[0].originalAmount).toBe(-300);
  });

  it('keeps inbound transactions positive', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ eventActivityTypeCode: 1, eventAmount: 300 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(300);
  });

  it('marks pending transactions (serialNumber=0)', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ serialNumber: 0 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('marks completed transactions (serialNumber > 0)', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ serialNumber: 5 })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Completed);
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

    expect(result.accounts![0].txns[0].memo).toBe('Transfer John. Rent Monthly.');
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
    expect(result.accounts![0].accountNumber).toBe('12-345-678');
  });

  it('uses empty string for missing description', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ activityDescription: undefined })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].description).toBe('');
  });

  it('includes rawTransaction when option set', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('all transactions have type Normal', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].type).toBe(TransactionTypes.Normal);
  });

  it('constructs memo with only partial beneficiary details', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([
      scrapedTxn({
        beneficiaryDetailsData: {
          partyHeadline: 'Wire',
          partyName: undefined,
          messageHeadline: undefined,
          messageDetail: undefined,
        },
      }),
    ]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].memo).toBe('Wire');
  });

  it('returns empty memo when beneficiary details are all empty', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ beneficiaryDetailsData: {} })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].memo).toBe('');
  });

  it('returns empty memo when no beneficiary details', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ beneficiaryDetailsData: undefined })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].memo).toBe('');
  });

  it('handles empty accounts list', async () => {
    setupLoginAndAccounts([]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles multiple open accounts', async () => {
    setupLoginAndAccounts([
      { bankNumber: '12', branchNumber: '100', accountNumber: '001', accountClosingReasonCode: 0 },
      { bankNumber: '12', branchNumber: '200', accountNumber: '002', accountClosingReasonCode: 0 },
    ]);
    mockBalance(5000);
    mockTransactions([scrapedTxn({ activityDescription: 'Acc1' })]);
    mockBalance(3000);
    mockTransactions([scrapedTxn({ activityDescription: 'Acc2' })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts![0].accountNumber).toBe('12-100-001');
    expect(result.accounts![1].accountNumber).toBe('12-200-002');
  });

  it('handles null balance response', async () => {
    setupLoginAndAccounts();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null); // balance
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBeUndefined();
  });

  it('handles empty transactions response', async () => {
    setupLoginAndAccounts();
    mockBalance();
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(0);
  });
});
