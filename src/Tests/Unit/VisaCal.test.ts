import { chromium } from 'playwright-extra';

import { buildContextOptions } from '../../Common/Browser';
import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { fetchPost } from '../../Common/Fetch';
import { getCurrentUrl, waitForUrl } from '../../Common/Navigation';
import { filterOldTransactions } from '../../Common/Transactions';
import { waitUntilWithReload } from '../../Common/Waiting';
import VisaCalScraper from '../../Scrapers/VisaCal/VisaCalScraper';
import { TrnTypeCode } from '../../Scrapers/VisaCal/VisaCalTypes';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage } from '../MockPage';
import {
  CREDS,
  INIT_RESPONSE,
  MOCK_BROWSER,
  MOCK_CONTEXT,
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
  waitUntilIframeFound: jest
    .fn()
    .mockResolvedValue({ url: (): string => 'https://connect.cal-online.co.il/login' }),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEval: jest.fn().mockResolvedValue(''),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://digital-web.cal-online.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
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

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock).mockResolvedValueOnce(INIT_RESPONSE);
    (fetchPost as jest.Mock).mockResolvedValueOnce(INIT_RESPONSE);
    (fetchPost as jest.Mock).mockResolvedValueOnce({
      result: { bankIssuedCards: { cardLevelFrames: [] } },
    });
    (fetchPost as jest.Mock).mockResolvedValueOnce({ statusCode: 96 });
    (fetchPost as jest.Mock).mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([
          scrapedTxn({ trnAmt: 250, merchantName: 'רמי לוי', trnTypeCode: TrnTypeCode.Regular }),
        ]),
      );

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const accounts = result.accounts ?? [];

    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountNumber).toBe('4580');
    const t = accounts[0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
  });

  it('detects installment transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([
          scrapedTxn({
            trnTypeCode: TrnTypeCode.Installments,
            numOfPayments: 12,
            curPaymentNum: 3,
          }),
        ]),
      );

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];

    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('handles credit transactions with positive amount', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([scrapedTxn({ trnTypeCode: TrnTypeCode.Credit, trnAmt: 50 })]),
      );

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].originalAmount).toBe(50);
  });

  it('handles pending transactions with statusCode 96 (no data)', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
  });

  it('throws on failed month data fetch', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce({ statusCode: 0, title: 'Error' });

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('fetch card');
  });

  it('calls filterOldTransactions when enabled', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions({ includeRawTransaction: true })).scrape(
      CREDS,
    );
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('extracts balance from frames data', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          bankIssuedCards: {
            cardLevelFrames: [{ cardUniqueId: 'card-1', nextTotalDebit: 5000 }],
          },
        },
      })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].balance).toBe(-5000);
  });

  it('assigns category from branchCodeDesc', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([scrapedTxn({ branchCodeDesc: 'מסעדות' })]),
      );

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].category).toBe('מסעדות');
  });

  it('returns auth error when init API statusCode is not 1', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock).mockResolvedValueOnce({ statusCode: 2, statusDescription: 'שגיאה' });

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(false);
  });

  it('merges pending transactions with completed ones', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce(mockPendingResponse([pendingTxn({ branchCodeDesc: 'קניות' })]))
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const txns = (result.accounts ?? [])[0].txns;
    const pending = txns.find(t => t.status === TransactionStatuses.Pending);
    const completed = txns.find(t => t.status === TransactionStatuses.Completed);

    expect(pending).toBeDefined();
    expect(pending?.description).toBe('Pending Shop');
    expect(pending?.originalAmount).toBe(-75);
    expect(completed).toBeDefined();
  });
});

describe('auth flow edge cases', () => {
  function makePageNoToken(): ReturnType<typeof createMockPage> {
    return createMockPage({
      frames: jest
        .fn()
        .mockReturnValue([{ url: (): string => 'https://connect.cal-online.co.il/login' }]),
      waitForResponse: jest.fn().mockRejectedValue(new Error('Timeout 15s')),
    });
  }

  it('falls back to sessionStorage when login token not intercepted', async () => {
    const page = makePageNoToken();
    MOCK_CONTEXT.newPage.mockResolvedValue(page);
    (waitUntilWithReload as jest.Mock).mockResolvedValue({
      found: true,
      value: { auth: { calConnectToken: 'session-token' } },
      reloadsUsed: 1,
      description: 'VisaCal auth-module',
    });
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(waitUntilWithReload).toHaveBeenCalled();
  });

  it('returns auth error when sessionStorage not populated after retries', async () => {
    const page = makePageNoToken();
    MOCK_CONTEXT.newPage.mockResolvedValue(page);
    (waitUntilWithReload as jest.Mock).mockResolvedValue({
      found: false,
      value: null,
      reloadsUsed: 2,
      description: 'VisaCal auth-module',
    });

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('auth token unavailable');
  });

  it('catches waitForPostLoginRedirect timeout and continues', async () => {
    setupVisaCalMocks();
    (waitForUrl as jest.Mock).mockRejectedValueOnce(new Error('redirect timeout'));
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
  });
});
