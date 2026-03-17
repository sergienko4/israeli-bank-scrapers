import { jest } from '@jest/globals';

import {
  type IScrapedPendingTransaction,
  type IScrapedTransaction,
  TrnTypeCode,
} from '../../Scrapers/VisaCal/VisaCalTypes.js';

interface IVisaCalPendingResponse {
  statusCode: number;
  result: {
    cardsList: { cardUniqueID: string; authDetalisList: IScrapedPendingTransaction[] }[];
  };
}

interface IVisaCalDebitDate {
  date: string;
  fromPurchaseDate: string;
  toPurchaseDate: string;
  transactions: IScrapedTransaction[];
  totalDebits: { currencySymbol: string; amount: number }[];
  totalBasketAmount: number;
  isChoiceRepaiment: boolean;
  choiceHHKDebit: number;
  fixDebitAmount: number;
  debitReason: null;
  basketAmountComment: null;
}

interface IVisaCalTxnDetailsResponse {
  statusCode: number;
  statusDescription: string;
  statusTitle: string;
  title: string;
  result: {
    bankAccounts: {
      bankAccountNum: string;
      bankName: string;
      choiceExternalTransactions: null;
      currentBankAccountInd: boolean;
      debitDates: IVisaCalDebitDate[];
      immidiateDebits: { totalDebits: never[]; debitDays: never[] };
    }[];
    blockedCardInd: boolean;
  };
}

/**
 * Build a default scraped transaction for VisaCal tests.
 * @param overrides - Partial transaction fields to override.
 * @returns Default scraped transaction merged with overrides.
 */
export function scrapedTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    amtBeforeConvAndIndex: 100,
    branchCodeDesc: '\u05DE\u05D6\u05D5\u05DF',
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
    merchantName: '\u05E1\u05D5\u05E4\u05E8 \u05E9\u05D5\u05E4',
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
    trnType: '\u05E8\u05D2\u05D9\u05DC\u05D4',
    trnTypeCode: TrnTypeCode.Regular,
    walletProviderCode: 0,
    walletProviderDesc: '',
    earlyPaymentInd: false,
    ...overrides,
  };
}

/**
 * Build a default pending transaction for VisaCal tests.
 * @param overrides - Partial pending transaction fields to override.
 * @returns Default pending transaction merged with overrides.
 */
export function pendingTxn(
  overrides: Partial<IScrapedPendingTransaction> = {},
): IScrapedPendingTransaction {
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
    trnType: '\u05E8\u05D2\u05D9\u05DC\u05D4',
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
 * Build a mock pending-transactions API response.
 * @param txns - Pending transactions to include.
 * @returns Mocked API response object.
 */
export function mockPendingResponse(txns: IScrapedPendingTransaction[]): IVisaCalPendingResponse {
  return {
    statusCode: 1,
    result: {
      cardsList: [{ cardUniqueID: 'card-1', authDetalisList: txns }],
    },
  };
}

/**
 * Build a mock card-transaction-details API response.
 * @param txns - Completed transactions to include.
 * @returns Mocked API response object.
 */
export function mockCardTransactionDetails(
  txns: IScrapedTransaction[] = [],
): IVisaCalTxnDetailsResponse {
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
  };
}

export const INIT_RESPONSE = {
  result: { cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }] },
};

export const EMPTY_CARDS_INIT_RESPONSE = {
  result: { cards: [] },
};

export { CREDS_USERNAME_PASSWORD as CREDS } from '../TestConstants.js';

export const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

export const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Create a mock iframe locator chain (getByText → first → waitFor/click/isVisible).
 * @returns A mock getByText implementation for iframe-like contexts.
 */
export function createIframeLocatorMock(): jest.Mock {
  return jest.fn().mockImplementation(() => {
    const loc = {
      first: jest.fn(),
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    loc.first.mockReturnValue(loc);
    return loc;
  });
}
