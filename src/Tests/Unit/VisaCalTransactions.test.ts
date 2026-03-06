import { chromium } from 'playwright-extra';

import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { fetchPost } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { filterOldTransactions } from '../../Common/Transactions';
import VisaCalScraper from '../../Scrapers/VisaCal/VisaCalScraper';
import { TrnTypeCode } from '../../Scrapers/VisaCal/VisaCalTypes';
import { TransactionTypes } from '../../Transactions';
import {
  CREDS,
  EMPTY_CARDS_INIT_RESPONSE,
  INIT_RESPONSE,
  MOCK_BROWSER,
  mockCardTransactionDetails,
  mockPendingResponse,
  pendingTxn,
  scrapedTxn,
  setupVisaCalMocks,
  visaCalOptions,
} from './VisaCalTestHelpers';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/Fetch', () => ({ fetchPost: jest.fn() }));
jest.mock('../../Common/Storage', () => ({ getFromSessionStorage: jest.fn() }));
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilIframeFound: jest.fn().mockResolvedValue({
    /**
     * Returns the mock VisaCal connect iframe URL.
     *
     * @returns the mock iframe URL string
     */
    url: (): string => 'https://connect.cal-online.co.il/login',
  }),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEval: jest.fn().mockResolvedValue(''),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://digital-web.cal-online.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Transactions', () => ({
  filterOldTransactions: jest.fn(<T>(txns: T[]): T[] => txns),
  getRawTransaction: jest.fn((data: unknown): unknown => data),
}));
jest.mock('../../Common/Waiting', () => ({
  waitUntil: jest.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
  waitUntilWithReload: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
  sleep: jest.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://digital-web.cal-online.co.il/dashboard');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

/**
 * Sets up the standard 5-call fetchPost mock chain for a VisaCal scrape cycle.
 *
 * @param txnDetails - the card transaction details response for the 5th mock call
 */
function mockFetchPostChain(txnDetails: object): void {
  (fetchPost as jest.Mock)
    .mockResolvedValueOnce(INIT_RESPONSE)
    .mockResolvedValueOnce(INIT_RESPONSE)
    .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
    .mockResolvedValueOnce({ statusCode: 96 })
    .mockResolvedValueOnce(txnDetails);
}

describe('fetchData (edge cases)', () => {
  it('handles standing order transaction type', async () => {
    setupVisaCalMocks();
    const d1 = mockCardTransactionDetails([scrapedTxn({ trnTypeCode: TrnTypeCode.StandingOrder })]);
    mockFetchPostChain(d1);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].type).toBe(TransactionTypes.Normal);
  });

  it('skips filtering when isFilterByDateEnabled is false', async () => {
    setupVisaCalMocks();
    const d2 = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(d2);

    const result = await new VisaCalScraper(
      visaCalOptions({ outputData: { isFilterByDateEnabled: false } }),
    ).scrape(CREDS);

    expect(result.success).toBe(true);
    expect(filterOldTransactions).not.toHaveBeenCalled();
  });

  it('handles failed pending transactions gracefully', async () => {
    setupVisaCalMocks();
    const d3 = mockCardTransactionDetails([scrapedTxn()]);
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 0, title: 'Pending failed' })
      .mockResolvedValueOnce(d3);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(true);
    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('handles foreign currency transactions', async () => {
    setupVisaCalMocks();
    const d4 = mockCardTransactionDetails([
      scrapedTxn({
        trnCurrencySymbol: 'USD',
        debCrdCurrencySymbol: 'ILS',
        trnAmt: 50,
        amtBeforeConvAndIndex: 180,
      }),
    ]);
    mockFetchPostChain(d4);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];

    expect(t.originalCurrency).toBe('USD');
    expect(t.chargedCurrency).toBe('ILS');
    expect(t.originalAmount).toBe(-50);
    expect(t.chargedAmount).toBe(-180);
  });

  it('sets chargedCurrency only for completed transactions', async () => {
    setupVisaCalMocks();
    const pendingResp = mockPendingResponse([
      pendingTxn({ merchantName: 'Pending', trnAmt: 100, trnCurrencySymbol: 'USD' }),
    ]);
    const emptyDetails = mockCardTransactionDetails([]);
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce(pendingResp)
      .mockResolvedValueOnce(emptyDetails);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].chargedCurrency).toBeUndefined();
  });

  it('returns empty accounts when card list is empty', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(EMPTY_CARDS_INIT_RESPONSE)
      .mockResolvedValueOnce(EMPTY_CARDS_INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } });

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles installment date shift', async () => {
    setupVisaCalMocks();
    const d5 = mockCardTransactionDetails([
      scrapedTxn({ trnTypeCode: TrnTypeCode.Installments, numOfPayments: 6, curPaymentNum: 3 }),
    ]);
    mockFetchPostChain(d5);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];

    expect(t.installments).toEqual({ number: 3, total: 6 });
    expect(t.date).toBeDefined();
  });

  it('handles pending statusCode 96 with no card match gracefully', async () => {
    setupVisaCalMocks();
    const d6 = mockCardTransactionDetails([scrapedTxn()]);
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96, result: { cardsList: [] } })
      .mockResolvedValueOnce(d6);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
  });
});
