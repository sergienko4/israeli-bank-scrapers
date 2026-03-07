import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
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

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  getGlobalEngineChain: jest.fn().mockReturnValue(['playwright-stealth']),
  BrowserEngineType: {
    Camoufox: 'camoufox',
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
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
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://digital-web.cal-online.co.il/dashboard');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

/**
 * Sets up the standard 5-call fetchPost mock chain for a VisaCal scrape cycle.
 *
 * @param txnDetails - the card transaction details response for the 5th mock call
 * @returns the jest Mock for further chaining if needed
 */
function mockFetchPostChain(txnDetails: object): jest.Mock {
  return (fetchPost as jest.Mock)
    .mockResolvedValueOnce(INIT_RESPONSE)
    .mockResolvedValueOnce(INIT_RESPONSE)
    .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
    .mockResolvedValueOnce({ statusCode: 96 })
    .mockResolvedValueOnce(txnDetails);
}

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupVisaCalMocks();
    const details1 = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(details1);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    setupVisaCalMocks();
    const details2 = mockCardTransactionDetails([
      scrapedTxn({ trnAmt: 250, merchantName: 'רמי לוי', trnTypeCode: TrnTypeCode.Regular }),
    ]);
    mockFetchPostChain(details2);

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
    const details3 = mockCardTransactionDetails([
      scrapedTxn({ trnTypeCode: TrnTypeCode.Installments, numOfPayments: 12, curPaymentNum: 3 }),
    ]);
    mockFetchPostChain(details3);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];

    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('handles credit transactions with positive amount', async () => {
    setupVisaCalMocks();
    const details4 = mockCardTransactionDetails([
      scrapedTxn({ trnTypeCode: TrnTypeCode.Credit, trnAmt: 50 }),
    ]);
    mockFetchPostChain(details4);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].originalAmount).toBe(50);
  });

  it('handles pending transactions with statusCode 96 (no data)', async () => {
    setupVisaCalMocks();
    const details5 = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(details5);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
  });

  it('throws on failed month data fetch', async () => {
    setupVisaCalMocks();
    mockFetchPostChain({ statusCode: 0, title: 'Error' });

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('fetch card');
  });

  it('calls filterOldTransactions when enabled', async () => {
    setupVisaCalMocks();
    const details6 = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(details6);
    await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    setupVisaCalMocks();
    const details7 = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(details7);
    const result = await new VisaCalScraper(visaCalOptions({ includeRawTransaction: true })).scrape(
      CREDS,
    );
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('extracts balance from frames data', async () => {
    setupVisaCalMocks();
    const details8 = mockCardTransactionDetails([scrapedTxn()]);
    const framesResp = {
      result: {
        bankIssuedCards: { cardLevelFrames: [{ cardUniqueId: 'card-1', nextTotalDebit: 5000 }] },
      },
    };
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(framesResp)
      .mockResolvedValueOnce({ statusCode: 96 })
      .mockResolvedValueOnce(details8);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].balance).toBe(-5000);
  });

  it('assigns category from branchCodeDesc', async () => {
    setupVisaCalMocks();
    const details9 = mockCardTransactionDetails([scrapedTxn({ branchCodeDesc: 'מסעדות' })]);
    mockFetchPostChain(details9);

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
    const pendingResp = mockPendingResponse([pendingTxn({ branchCodeDesc: 'קניות' })]);
    const completedResp = mockCardTransactionDetails([scrapedTxn()]);
    (fetchPost as jest.Mock)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce(INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
      .mockResolvedValueOnce(pendingResp)
      .mockResolvedValueOnce(completedResp);

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
  /**
   * Creates a mock page simulating a VisaCal session where the auth token cannot be captured.
   *
   * @returns a mock page with the login response timing out
   */
  function makePageNoToken(): ReturnType<typeof createMockPage> {
    return createMockPage({
      frames: jest.fn().mockReturnValue([
        {
          /**
           * Returns the mock VisaCal connect iframe URL.
           *
           * @returns the connect iframe URL string
           */
          url: (): string => 'https://connect.cal-online.co.il/login',
        },
      ]),
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
    const detailsA = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(detailsA);

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
    const detailsB = mockCardTransactionDetails([scrapedTxn()]);
    mockFetchPostChain(detailsB);

    const result = await new VisaCalScraper(visaCalOptions()).scrape(CREDS);
    expect(result.success).toBe(true);
  });
});
