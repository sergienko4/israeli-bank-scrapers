import type { CurrencySymbol, TrnTypeCode } from '../VisaCalBaseTypes.js';

export interface IScrapedPendingTransaction {
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
