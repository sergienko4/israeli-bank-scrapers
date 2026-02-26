import puppeteer from 'puppeteer';
import moment from 'moment';
import { SHEKEL_CURRENCY } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { applyAntiDetection } from '../helpers/browser';
import { filterOldTransactions, fixInstallments } from '../helpers/transactions';
import { sleep } from '../helpers/waiting';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import IsracardAmexBaseScraper from './base-isracard-amex';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../helpers/fetch', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.mock('../helpers/browser', () => ({
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn((actions: (() => Promise<any>)[]) => {
    return actions.reduce((p, a) => p.then(async r => [...r, await a()]), Promise.resolve([] as any[]));
  }),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../helpers/transactions', () => ({
  fixInstallments: jest.fn((txns: any[]) => txns),
  filterOldTransactions: jest.fn((txns: any[]) => txns),
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));
jest.mock('../helpers/dates', () => {
  return jest.fn(() => [moment('2024-06-01')]);
});

const BASE_URL = 'https://digital.americanexpress.co.il';

class TestAmexScraper extends IsracardAmexBaseScraper {
  constructor(overrides = {}) {
    super(createMockScraperOptions(overrides), BASE_URL, '77');
  }
}

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', card6Digits: '123456' };

function mockValidate(returnCode = '1', userName = 'TestUser') {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    ValidateIdDataBean: { returnCode, userName },
  });
}

function mockLogin(status = '1') {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ status });
}

function mockAccounts(cardNumber = '1234') {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    DashboardMonthBean: {
      cardsCharges: [{ cardIndex: '0', cardNumber, billingDate: '15/06/2024' }],
    },
  });
}

function mockTxns(txnIsrael: any[] = [], txnAbroad: any[] = []) {
  const txnGroups: any = {};
  if (txnIsrael.length) txnGroups.txnIsrael = txnIsrael;
  if (txnAbroad.length) txnGroups.txnAbroad = txnAbroad;
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    CardsTransactionsListBean: {
      Index0: { CurrentCardTransactions: [txnGroups] },
    },
  });
}

function setupFullLogin() {
  mockValidate('1');
  mockLogin('1');
}

function txn(overrides: any = {}): any {
  return {
    dealSumType: '0',
    voucherNumberRatz: '123456789',
    voucherNumberRatzOutbound: '987654321',
    dealSumOutbound: false,
    currencyId: 'ש"ח',
    currentPaymentCurrency: 'ש"ח',
    dealSum: 100,
    paymentSum: 100,
    paymentSumOutbound: 0,
    fullPurchaseDate: '15/06/2024',
    fullSupplierNameHeb: 'סופר שופ',
    fullSupplierNameOutbound: '',
    moreInfo: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createMockPage());
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    mockValidate('1');
    mockLogin('1');
    const scraper = new TestAmexScraper();
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(applyAntiDetection).toHaveBeenCalled();
  });

  it('returns ChangePassword when returnCode=4', async () => {
    mockValidate('4');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when returnCode is unknown', async () => {
    mockValidate('99');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword when login status=3', async () => {
    mockValidate('1');
    mockLogin('3');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when login status is unknown', async () => {
    mockValidate('1');
    mockLogin('9');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns WafBlocked with details when validateCredentials returns null', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorMessage).toContain('WAF blocked');
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.suggestions.length).toBeGreaterThan(0);
  });

  it('returns WafBlocked when validate Header.Status is not 1', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorDetails).toBeDefined();
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    setupFullLogin();
    mockAccounts('4580-1234');
    mockTxns([txn({ dealSum: 250, fullSupplierNameHeb: 'רמי לוי' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('4580-1234');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('handles abroad transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns(
      [],
      [
        txn({
          dealSumOutbound: true,
          fullPurchaseDateOutbound: '10/06/2024',
          fullSupplierNameOutbound: 'Amazon US',
          currentPaymentCurrency: 'USD',
          currencyId: 'USD',
          paymentSumOutbound: 50,
        }),
      ],
    );

    const result = await new TestAmexScraper().scrape(CREDS);
    const t = result.accounts![0].txns[0];
    expect(t.description).toBe('Amazon US');
    expect(t.originalCurrency).toBe('USD');
    expect(t.chargedAmount).toBe(-50);
  });

  it('detects installment transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ moreInfo: 'תשלום 3 מתוך 12' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    const t = result.accounts![0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('filters dealSumType=1 transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ dealSumType: '1' }), txn()]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('filters zero voucher numbers', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ voucherNumberRatz: '000000000', voucherNumberRatzOutbound: '000000000' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('returns empty when Header.Status is not 1', async () => {
    setupFullLogin();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('calls fixInstallments when combineInstallments=false', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper({ combineInstallments: false }).scrape(CREDS);
    expect(fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when combineInstallments=true', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper({ combineInstallments: true }).scrape(CREDS);
    expect(fixInstallments).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper().scrape(CREDS);
    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('applies rate limiting', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper().scrape(CREDS);
    expect(sleep).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    const result = await new TestAmexScraper({ includeRawTransaction: true }).scrape(CREDS);
    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });
});

describe('progress events', () => {
  it('emits LoggingIn and LoginSuccess', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([]);
    const events: ScraperProgressTypes[] = [];
    const scraper = new TestAmexScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape(CREDS);
    expect(events).toContain(ScraperProgressTypes.LoggingIn);
    expect(events).toContain(ScraperProgressTypes.LoginSuccess);
  });

  it('emits LoginFailed on invalid password', async () => {
    mockValidate('99');
    const events: ScraperProgressTypes[] = [];
    const scraper = new TestAmexScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape(CREDS);
    expect(events).toContain(ScraperProgressTypes.LoginFailed);
  });
});
