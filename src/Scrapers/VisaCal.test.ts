import { chromium } from 'playwright';

import { buildContextOptions } from '../Helpers/Browser';
import { elementPresentOnPage } from '../Helpers/ElementsInteractions';
import { fetchPost } from '../Helpers/Fetch';
import { getCurrentUrl } from '../Helpers/Navigation';
import { getFromSessionStorage } from '../Helpers/Storage';
import { filterOldTransactions } from '../Helpers/Transactions';
import { waitUntil } from '../Helpers/Waiting';
import { createMockPage, createMockScraperOptions } from '../Tests/MockPage';
import { TransactionStatuses, TransactionTypes } from '../Transactions';
import VisaCalScraper from './VisaCal';
import {
  type ScrapedPendingTransaction,
  type ScrapedTransaction,
  TrnTypeCode,
} from './VisaCalTypes';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../Helpers/Fetch', () => ({ fetchPost: jest.fn() }));
jest.mock('../Helpers/Storage', () => ({ getFromSessionStorage: jest.fn() }));
jest.mock('../Helpers/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEval: jest.fn().mockResolvedValue(''),
}));
jest.mock('../Helpers/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://digital-web.cal-online.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../Helpers/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../Helpers/Transactions', () => ({
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../Helpers/Waiting', () => ({
  waitUntil: jest.fn(async <T>(fn: () => Promise<T>) => fn()),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
  sleep: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../Helpers/Debug', () => ({ getDebug: () => jest.fn() }));

function visaCalOptions(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createMockScraperOptions> {
  return createMockScraperOptions({ startDate: new Date(), futureMonthsToScrape: 0, ...overrides });
}

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function scrapedTxn(overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction {
  return {
    amtBeforeConvAndIndex: 100,
    branchCodeDesc: 'מזון',
    cashAccManagerName: null,
    cashAccountManager: null,
    cashAccountTrnAmt: 100,
    chargeExternalToCardComment: '',
    comments: [],
    curPaymentNum: 0,
    debCrdCurrencySymbol: 'ILS',
    debCrdDate: '2025-06-15',
    debitSpreadInd: false,
    discountAmount: null,
    discountReason: null,
    immediateComments: [],
    isImmediateCommentInd: false,
    isImmediateHHKInd: false,
    isMargarita: false,
    isSpreadPaymenstAbroad: false,
    linkedComments: [],
    merchantAddress: '',
    merchantName: 'סופר שופ',
    merchantPhoneNo: '',
    numOfPayments: 0,
    onGoingTransactionsComment: '',
    refundInd: false,
    roundingAmount: null,
    roundingReason: null,
    tokenInd: 0,
    tokenNumberPart4: '',
    transCardPresentInd: false,
    transTypeCommentDetails: [],
    trnAmt: 100,
    trnCurrencySymbol: 'ILS',
    trnExacWay: 0,
    trnIntId: 'TRN-001',
    trnNumaretor: 0,
    trnPurchaseDate: '2025-06-10',
    trnType: 'רגילה',
    trnTypeCode: TrnTypeCode.Regular,
    walletProviderCode: 0,
    walletProviderDesc: '',
    earlyPaymentInd: false,
    ...overrides,
  };
}

function pendingTxn(overrides: Partial<ScrapedPendingTransaction> = {}): ScrapedPendingTransaction {
  return {
    merchantID: 'M1',
    merchantName: 'Pending Shop',
    trnPurchaseDate: '2025-06-10',
    walletTranInd: 0,
    transactionsOrigin: 0,
    trnAmt: 75,
    tpaApprovalAmount: null,
    trnCurrencySymbol: 'ILS',
    trnTypeCode: TrnTypeCode.Regular,
    trnType: 'רגילה',
    branchCodeDesc: '',
    transCardPresentInd: false,
    j5Indicator: '',
    numberOfPayments: 0,
    firstPaymentAmount: 0,
    transTypeCommentDetails: [],
    ...overrides,
  };
}

function mockPendingResponse(txns: ScrapedPendingTransaction[] = [pendingTxn()]): object {
  return {
    statusCode: 1,
    result: {
      cardsList: [{ cardUniqueID: 'card-1', authDetalisList: txns }],
    },
  };
}

function mockCardTransactionDetails(
  txns: ScrapedTransaction[] = [],
  overrides: Record<string, unknown> = {},
): object {
  return {
    statusCode: 1,
    statusDescription: 'OK',
    statusTitle: '',
    title: '',
    result: {
      bankAccounts: [
        {
          bankAccountNum: '12345',
          bankName: 'Test',
          choiceExternalTransactions: null,
          currentBankAccountInd: true,
          debitDates: [
            {
              date: '2025-06-15',
              fromPurchaseDate: '2025-05-01',
              toPurchaseDate: '2025-05-31',
              transactions: txns,
              totalDebits: [{ currencySymbol: 'ILS', amount: 100 }],
              totalBasketAmount: 0,
              isChoiceRepaiment: false,
              choiceHHKDebit: 0,
              fixDebitAmount: 0,
              debitReason: null,
              basketAmountComment: null,
            },
          ],
          immidiateDebits: { totalDebits: [], debitDays: [] },
        },
      ],
      blockedCardInd: false,
    },
    ...overrides,
  };
}

function setupVisaCalMocks(): ReturnType<typeof createMockPage> {
  const page = createMockPage({
    frames: jest.fn().mockReturnValue([
      {
        url: () => 'https://connect.cal-online.co.il/login',
        waitForSelector: jest.fn().mockResolvedValue(undefined),
      },
    ]),
    waitForRequest: jest.fn().mockResolvedValue({
      headers: () => ({ authorization: 'Bearer auth-token' }),
    }),
  });
  mockContext.newPage.mockResolvedValue(page);

  // waitUntil: return session storage data
  (waitUntil as jest.Mock).mockImplementation(async <T>(fn: () => Promise<T>) => {
    return fn();
  });

  // getFromSessionStorage: return init data with cards
  (getFromSessionStorage as jest.Mock).mockImplementation((_page: unknown, key: string) => {
    if (key === 'init') {
      return Promise.resolve({
        result: {
          cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }],
        },
      });
    }
    if (key === 'auth-module') {
      return Promise.resolve({
        auth: { calConnectToken: 'cal-auth-token' },
      });
    }
    return Promise.resolve(null);
  });

  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://digital-web.cal-online.co.il/dashboard');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupVisaCalMocks();
    // Frames response
    (fetchPost as jest.Mock).mockResolvedValueOnce({
      result: { bankIssuedCards: { cardLevelFrames: [] } },
    });
    // Pending transactions
    (fetchPost as jest.Mock).mockResolvedValueOnce({ statusCode: 96 });
    // Month data
    (fetchPost as jest.Mock).mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([
          scrapedTxn({ trnAmt: 250, merchantName: 'רמי לוי', trnTypeCode: TrnTypeCode.Regular }),
        ]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('4580');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
  });

  it('detects installment transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
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

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('handles credit transactions with positive amount', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([scrapedTxn({ trnTypeCode: TrnTypeCode.Credit, trnAmt: 50 })]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(50);
  });

  it('handles pending transactions with statusCode 96 (no data)', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
  });

  it('throws on failed month data fetch', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce({ statusCode: 0, title: 'Error' });

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('failed to fetch transactions');
  });

  it('calls filterOldTransactions when enabled', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const result = await new VisaCalScraper(visaCalOptions({ includeRawTransaction: true })).scrape(
      CREDS,
    );

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('extracts balance from frames data', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({
        result: {
          bankIssuedCards: {
            cardLevelFrames: [{ cardUniqueId: 'card-1', nextTotalDebit: 5000 }],
          },
        },
      })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBe(-5000);
  });

  it('assigns category from branchCodeDesc', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([scrapedTxn({ branchCodeDesc: 'מסעדות' })]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].category).toBe('מסעדות');
  });

  it('merges pending transactions with completed ones', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce(mockPendingResponse([pendingTxn({ branchCodeDesc: 'קניות' })]))
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    const pending = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Pending);
    const completed = result.accounts![0].txns.find(
      t => t.status === TransactionStatuses.Completed,
    );
    expect(pending).toBeDefined();
    expect(pending!.description).toBe('Pending Shop');
    expect(pending!.originalAmount).toBe(-75);
    expect(completed).toBeDefined();
  });

  it('handles standing order transaction type', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([scrapedTxn({ trnTypeCode: TrnTypeCode.StandingOrder })]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].type).toBe(TransactionTypes.Normal);
  });

  it('skips filtering when isFilterByDateEnabled is false', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(
      visaCalOptions({ outputData: { isFilterByDateEnabled: false } }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(filterOldTransactions).not.toHaveBeenCalled();
  });

  it('handles failed pending transactions gracefully', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 0, title: 'Pending failed' })
      .mockResolvedValueOnce(mockCardTransactionDetails([scrapedTxn()]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('handles foreign currency transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([
          scrapedTxn({
            trnCurrencySymbol: 'USD',
            debCrdCurrencySymbol: 'ILS',
            trnAmt: 50,
            amtBeforeConvAndIndex: 180,
          }),
        ]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.originalCurrency).toBe('USD');
    expect(t.chargedCurrency).toBe('ILS');
    expect(t.originalAmount).toBe(-50);
    expect(t.chargedAmount).toBe(-180);
  });

  it('sets chargedCurrency only for completed transactions', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce(
        mockPendingResponse([
          pendingTxn({ merchantName: 'Pending', trnAmt: 100, trnCurrencySymbol: 'USD' }),
        ]),
      )
      .mockResolvedValueOnce(mockCardTransactionDetails([]));

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    const pendingResult = result.accounts![0].txns[0];
    expect(pendingResult.chargedCurrency).toBeUndefined();
  });

  it('returns empty accounts when card list is empty', async () => {
    setupVisaCalMocks();
    (getFromSessionStorage as jest.Mock).mockImplementation((_page: unknown, key: string) => {
      if (key === 'init') return Promise.resolve({ result: { cards: [] } });
      if (key === 'auth-module') return Promise.resolve({ auth: { calConnectToken: 'tok' } });
      return Promise.resolve(null);
    });
    (fetchPost as jest.Mock).mockResolvedValueOnce({
      result: { bankIssuedCards: { cardLevelFrames: [] } },
    });

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles installment date shift', async () => {
    setupVisaCalMocks();
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(
        mockCardTransactionDetails([
          scrapedTxn({ trnTypeCode: TrnTypeCode.Installments, numOfPayments: 6, curPaymentNum: 3 }),
        ]),
      );

    const scraper = new VisaCalScraper(visaCalOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.installments).toEqual({ number: 3, total: 6 });
    // Date should be shifted by (curPaymentNum - 1) months from purchase date
    expect(t.date).toBeDefined();
  });
});
