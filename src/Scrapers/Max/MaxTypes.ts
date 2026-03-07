import type { Moment } from 'moment';

import type { IScrapedTransaction } from '../../Interfaces/Banks/Max/ScrapedTransaction';
import type { ITransaction } from '../../Transactions';

export type { IScrapedTransaction } from '../../Interfaces/Banks/Max/ScrapedTransaction';

export interface IFetchCategoryResult {
  result?: {
    id: number;
    name: string;
  }[];
}

export interface IScrapedTransactionsResult {
  result?: {
    transactions: IScrapedTransaction[];
  };
}

export interface IPrepareOpts {
  txns: ITransaction[];
  startMoment: Moment;
  shouldCombineInstallments: boolean;
  isFilterByDateEnabled: boolean;
}

export enum MaxPlanName {
  Normal = 'רגילה',
  ImmediateCharge = 'חיוב עסקות מיידי',
  InternetShopping = 'אינטרנט/חו"ל',
  Installments = 'תשלומים',
  MonthlyCharge = 'חיוב חודשי',
  OneMonthPostponed = 'דחוי חודש',
  MonthlyPostponed = 'דחוי לחיוב החודשי',
  MonthlyPayment = 'תשלום חודשי',
  FuturePurchaseFinancing = 'מימון לרכישה עתידית',
  MonthlyPostponedInstallments = 'דחוי חודש תשלומים',
  ThirtyDaysPlus = 'עסקת 30 פלוס',
  TwoMonthsPostponed = 'דחוי חודשיים',
  TwoMonthsPostponed2 = "דחוי 2 ח' תשלומים",
  MonthlyChargeDistribution = 'חלוקת חיוב חודשי',
  MonthlyChargePlusInterest = 'חודשי + ריבית',
  Credit = 'קרדיט',
  CreditOutsideTheLimit = 'קרדיט-מחוץ למסגרת',
  AccumulatingBasket = 'סל מצטבר',
  PostponedTransactionInstallments = 'פריסת העסקה הדחויה',
  ReplacementCard = 'כרטיס חליפי',
  EarlyRepayment = 'פרעון מוקדם',
  MonthlyCardFee = 'דמי כרטיס',
  CurrencyPocket = 'חיוב ארנק מטח',
}
