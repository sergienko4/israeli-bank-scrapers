import { chromium } from 'playwright-extra';

import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { waitUntil } from '../../Common/Waiting';
import HapoalimScraper from '../../Scrapers/Hapoalim/HapoalimScraper';
import { TransactionTypes } from '../../Transactions';
import { HEBREW_TRANSACTION_TYPES } from '../HebrewBankingFixtures';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
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
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.mock('uuid', () => ({ v4: jest.fn((): string => 'mock-uuid') }));
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

function createHapoalimPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce('/api/v1'),
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
    serialNumber: 1,
    activityDescription: HEBREW_TRANSACTION_TYPES[0],
    eventAmount: 100,
    eventDate: '20240615',
    valueDate: '20240616',
    referenceNumber: 12345,
    eventActivityTypeCode: 2,
    currentBalance: 10000,
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
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  (waitUntil as jest.Mock).mockImplementation(async (fn: () => Promise<boolean>) => {
    await fn();
  });
  mockAccounts(accounts);
  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  MOCK_CONTEXT.newPage.mockResolvedValue(createHapoalimPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://login.bankhapoalim.co.il/portalserver/HomePage',
  );
});

describe('fetchData extra', () => {
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

    expect((result.accounts ?? [])[0].txns[0].memo).toBe('Wire');
  });

  it('returns empty memo when beneficiary details are all empty', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ beneficiaryDetailsData: {} })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].memo).toBe('');
  });

  it('returns empty memo when no beneficiary details', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn({ beneficiaryDetailsData: undefined })]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].memo).toBe('');
  });

  it('all transactions have type Normal', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].type).toBe(TransactionTypes.Normal);
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
    expect((result.accounts ?? [])[0].accountNumber).toBe('12-100-001');
    expect((result.accounts ?? [])[1].accountNumber).toBe('12-200-002');
  });

  it('handles null balance response', async () => {
    setupLoginAndAccounts();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].balance).toBeUndefined();
  });

  it('handles empty transactions response', async () => {
    setupLoginAndAccounts();
    mockBalance();
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(0);
  });
});
