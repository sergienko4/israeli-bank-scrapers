/* eslint-disable @typescript-eslint/unbound-method */
import puppeteer from 'puppeteer';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { applyAntiDetection } from '../helpers/browser';
import { waitUntil } from '../helpers/waiting';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import HapoalimScraper from './hapoalim';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../helpers/fetch', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.mock('../helpers/browser', () => ({
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
  isBotDetectionScript: jest.fn(() => false),
  interceptionPriorities: { abort: 1000, continue: 10 },
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://login.bankhapoalim.co.il/portalserver/HomePage'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/waiting', () => ({
  waitUntil: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { userCode: 'user123', password: 'pass456' };

function createHapoalimPage() {
  return createMockPage({
    evaluate: jest
      .fn()
      .mockResolvedValueOnce(true) // waitUntil → bnhpApp exists
      .mockResolvedValueOnce('/api/v1'), // getRestContext → restContext
    cookies: jest.fn().mockResolvedValue([{ name: 'XSRF-TOKEN', value: 'xsrf-token-value' }]),
  });
}

function mockAccounts(accounts: any[] = []) {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(accounts);
}

function mockBalance(balance = 10000) {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ currentBalance: balance });
}

function mockTransactions(txns: any[] = []) {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ transactions: txns });
}

function scrapedTxn(overrides: any = {}): any {
  return {
    serialNumber: 1,
    activityDescription: 'העברה בנקאית',
    eventAmount: 500,
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
  accounts: any[] = [{ bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 }],
) {
  const page = createHapoalimPage();
  mockBrowser.newPage.mockResolvedValue(page);
  (waitUntil as jest.Mock).mockImplementation(async (fn: () => Promise<boolean>) => {
    await fn();
  });
  mockAccounts(accounts);
  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createHapoalimPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://login.bankhapoalim.co.il/portalserver/HomePage');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([scrapedTxn()]);

    const scraper = new HapoalimScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(applyAntiDetection).toHaveBeenCalled();
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
});
