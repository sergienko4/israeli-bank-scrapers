import { getFromSessionStorage } from '../../Common/Storage';
import { waitUntil, waitUntilWithReload } from '../../Common/Waiting';
import {
  type ScrapedPendingTransaction,
  type ScrapedTransaction,
  TrnTypeCode,
} from '../../Scrapers/VisaCal/VisaCalTypes';
import {
  createMockBrowser,
  createMockContext,
  createMockCredentials,
  createMockPage,
  createMockScraperOptions,
} from '../MockPage';

export const MOCK_CONTEXT: ReturnType<typeof createMockContext> = createMockContext();
export const MOCK_BROWSER: ReturnType<typeof createMockBrowser> = createMockBrowser(MOCK_CONTEXT);

export const CREDS = createMockCredentials('visacal');

const MOCK_INIT_USER = { custFullName: 'Test User', custExtId: '123456789' };

export const INIT_RESPONSE = {
  statusCode: 1,
  statusDescription: null,
  statusTitle: null,
  groupPid: null,
  result: {
    user: MOCK_INIT_USER,
    cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }],
    bankAccounts: [],
  },
};

export const EMPTY_CARDS_INIT_RESPONSE = {
  statusCode: 1,
  statusDescription: null,
  statusTitle: null,
  groupPid: null,
  result: { user: MOCK_INIT_USER, cards: [], bankAccounts: [] },
};

/**
 * Creates mock ScraperOptions for VisaCal unit tests.
 *
 * @param overrides - optional overrides for the default VisaCal test options
 * @returns a ScraperOptions object suitable for VisaCal tests
 */
export function visaCalOptions(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createMockScraperOptions> {
  return createMockScraperOptions({ startDate: new Date(), futureMonthsToScrape: 0, ...overrides });
}

/**
 * Creates a mock ScrapedTransaction with sensible defaults for VisaCal tests.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a ScrapedTransaction object for use in VisaCal unit tests
 */
export function scrapedTxn(overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction {
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

/**
 * Creates a mock ScrapedPendingTransaction with defaults for VisaCal tests.
 *
 * @param overrides - optional field overrides for the mock pending transaction
 * @returns a ScrapedPendingTransaction object for use in VisaCal unit tests
 */
export function pendingTxn(
  overrides: Partial<ScrapedPendingTransaction> = {},
): ScrapedPendingTransaction {
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

/**
 * Creates a mock VisaCal pending transactions API response.
 *
 * @param txns - the pending transactions to include in the mock response
 * @returns a mock API response object with the given pending transactions
 */
export function mockPendingResponse(txns: ScrapedPendingTransaction[] = [pendingTxn()]): object {
  return {
    statusCode: 1,
    result: {
      cardsList: [{ cardUniqueID: 'card-1', authDetalisList: txns }],
    },
  };
}

/**
 * Creates a mock VisaCal card transaction details API response.
 *
 * @param txns - the completed transactions to include in the mock response
 * @param overrides - optional top-level overrides for the response object
 * @returns a mock API response object with the given transactions
 */
export function mockCardTransactionDetails(
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

/**
 * Sets up all mock functions required for VisaCal scraper unit tests.
 *
 * @returns the mock page configured with VisaCal-specific mock responses
 */
export function setupVisaCalMocks(): ReturnType<typeof createMockPage> {
  const page = createMockPage({
    frames: jest.fn().mockReturnValue([
      {
        /**
         * Returns the mock VisaCal connect iframe URL.
         *
         * @returns the mock connect iframe URL string
         */
        url: (): string => 'https://connect.cal-online.co.il/login',
        waitForSelector: jest.fn().mockResolvedValue(undefined),
      },
    ]),
    waitForResponse: jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ token: 'cal-auth-token' }),
      /**
       * Returns the mock login response URL.
       *
       * @returns the mock login endpoint URL string
       */
      url: (): string =>
        'https://connect.cal-online.co.il/col-rest/calconnect/authentication/login',
      /**
       * Returns the mock request object for the login response.
       *
       * @returns a mock request with a method() function
       */
      request: (): { method: () => string } => ({
        /**
         * Returns the mock HTTP method for the login request.
         *
         * @returns the HTTP method string 'POST'
         */
        method: (): string => 'POST',
      }),
    }),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);

  (waitUntil as jest.Mock).mockImplementation(async <T>(fn: () => Promise<T>): Promise<T> => fn());

  (waitUntilWithReload as jest.Mock).mockResolvedValue({
    found: true,
    value: { auth: { calConnectToken: 'cal-auth-token' } },
    reloadsUsed: 0,
    description: 'VisaCal auth-module',
  });

  (getFromSessionStorage as jest.Mock).mockImplementation(
    (_page: unknown, key: string): Promise<unknown> => {
      if (key === 'init') {
        return Promise.resolve({
          result: { cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }] },
        });
      }
      if (key === 'auth-module') {
        return Promise.resolve({ auth: { calConnectToken: 'cal-auth-token' } });
      }
      return Promise.resolve(null);
    },
  );

  return page;
}
