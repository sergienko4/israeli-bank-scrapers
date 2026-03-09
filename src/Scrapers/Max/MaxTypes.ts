import { TransactionTypes } from '../../Transactions.js';

export type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';

/** Parsed installment info. */
export interface IInstallmentInfo {
  number: number;
  total: number;
}

/** Empty installment placeholder. */
export interface INoInstallment {
  number: undefined;
  total: undefined;
}

/** Currency fallback when ID is unknown. */
export interface IUnknownCurrency {
  code: undefined;
}

/** Identifier fallback when no ARN exists. */
export interface INoIdentifier {
  id: undefined;
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

/** Map plan name to transaction type. */
export const PLAN_TYPE_MAP: Partial<Record<MaxPlanName, TransactionTypes>> = {
  [MaxPlanName.ImmediateCharge]: TransactionTypes.Normal,
  [MaxPlanName.Normal]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCharge]: TransactionTypes.Normal,
  [MaxPlanName.OneMonthPostponed]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponed]: TransactionTypes.Normal,
  [MaxPlanName.FuturePurchaseFinancing]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponedInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ThirtyDaysPlus]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed2]: TransactionTypes.Normal,
  [MaxPlanName.AccumulatingBasket]: TransactionTypes.Normal,
  [MaxPlanName.InternetShopping]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargePlusInterest]: TransactionTypes.Normal,
  [MaxPlanName.PostponedTransactionInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ReplacementCard]: TransactionTypes.Normal,
  [MaxPlanName.EarlyRepayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCardFee]: TransactionTypes.Normal,
  [MaxPlanName.CurrencyPocket]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargeDistribution]: TransactionTypes.Normal,
  [MaxPlanName.Installments]: TransactionTypes.Installments,
  [MaxPlanName.Credit]: TransactionTypes.Installments,
  [MaxPlanName.CreditOutsideTheLimit]: TransactionTypes.Installments,
};

/** Map plan type ID to transaction type. */
export const PLAN_ID_MAP: Record<number, TransactionTypes> = {
  2: TransactionTypes.Installments,
  3: TransactionTypes.Installments,
  5: TransactionTypes.Normal,
};
