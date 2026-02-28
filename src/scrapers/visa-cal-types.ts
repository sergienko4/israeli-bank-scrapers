export enum TrnTypeCode {
  regular = '5',
  credit = '6',
  installments = '8',
  standingOrder = '9',
}

export interface ScrapedTransaction {
  amtBeforeConvAndIndex: number;
  branchCodeDesc: string;
  cashAccManagerName: null;
  cashAccountManager: null;
  cashAccountTrnAmt: number;
  chargeExternalToCardComment: string;
  comments: [];
  curPaymentNum: number;
  debCrdCurrencySymbol: CurrencySymbol;
  debCrdDate: string;
  debitSpreadInd: boolean;
  discountAmount: unknown;
  discountReason: unknown;
  immediateComments: [];
  isImmediateCommentInd: boolean;
  isImmediateHHKInd: boolean;
  isMargarita: boolean;
  isSpreadPaymenstAbroad: boolean;
  linkedComments: [];
  merchantAddress: string;
  merchantName: string;
  merchantPhoneNo: string;
  numOfPayments: number;
  onGoingTransactionsComment: string;
  refundInd: boolean;
  roundingAmount: unknown;
  roundingReason: unknown;
  tokenInd: 0;
  tokenNumberPart4: '';
  transCardPresentInd: boolean;
  transTypeCommentDetails: [];
  trnAmt: number;
  trnCurrencySymbol: CurrencySymbol;
  trnExacWay: number;
  trnIntId: string;
  trnNumaretor: number;
  trnPurchaseDate: string;
  trnType: string;
  trnTypeCode: TrnTypeCode;
  walletProviderCode: 0;
  walletProviderDesc: '';
  earlyPaymentInd: boolean;
}
export interface ScrapedPendingTransaction {
  merchantID: string;
  merchantName: string;
  trnPurchaseDate: string;
  walletTranInd: number;
  transactionsOrigin: number;
  trnAmt: number;
  tpaApprovalAmount: unknown;
  trnCurrencySymbol: CurrencySymbol;
  trnTypeCode: TrnTypeCode;
  trnType: string;
  branchCodeDesc: string;
  transCardPresentInd: boolean;
  j5Indicator: string;
  numberOfPayments: number;
  firstPaymentAmount: number;
  transTypeCommentDetails: [];
}
export interface InitResponse {
  result: {
    cards: {
      cardUniqueId: string;
      last4Digits: string;
      [key: string]: unknown;
    }[];
  };
}
export type CurrencySymbol = string;
export interface CardApiStatus {
  title: string;
  statusCode: number;
}
/** @deprecated use CardApiStatus */
export type CardTransactionDetailsError = CardApiStatus;
export interface CardTransactionDetails extends CardApiStatus {
  result: {
    bankAccounts: {
      bankAccountNum: string;
      bankName: string;
      choiceExternalTransactions: unknown;
      currentBankAccountInd: boolean;
      debitDates: {
        basketAmountComment: unknown;
        choiceHHKDebit: number;
        date: string;
        debitReason: unknown;
        fixDebitAmount: number;
        fromPurchaseDate: string;
        isChoiceRepaiment: boolean;
        toPurchaseDate: string;
        totalBasketAmount: number;
        totalDebits: {
          currencySymbol: CurrencySymbol;
          amount: number;
        }[];
        transactions: ScrapedTransaction[];
      }[];
      immidiateDebits: { totalDebits: []; debitDays: [] };
    }[];
    blockedCardInd: boolean;
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}
export interface CardPendingTransactionDetails extends CardTransactionDetailsError {
  result: {
    cardsList: {
      cardUniqueID: string;
      authDetalisList: ScrapedPendingTransaction[];
    }[];
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}

export interface CardLevelFrame {
  cardUniqueId: string;
  nextTotalDebit?: number;
}

export interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
  };
}

export interface AuthModule {
  auth: {
    calConnectToken: string | null;
  };
}

export function isAuthModule(result: unknown): result is AuthModule {
  return Boolean(
    (result as AuthModule)?.auth?.calConnectToken && String((result as AuthModule).auth.calConnectToken).trim(),
  );
}

export function authModuleOrUndefined(result: unknown): AuthModule | undefined {
  return isAuthModule(result) ? result : undefined;
}

export function isPending(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): transaction is ScrapedPendingTransaction {
  return (transaction as ScrapedTransaction).debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}

export function isCardTransactionDetails(
  result: CardTransactionDetails | CardTransactionDetailsError,
): result is CardTransactionDetails {
  return (result as CardTransactionDetails).result !== undefined;
}

export function isCardPendingTransactionDetails(
  result: CardPendingTransactionDetails | CardTransactionDetailsError,
): result is CardPendingTransactionDetails {
  return (result as CardPendingTransactionDetails).result !== undefined;
}
