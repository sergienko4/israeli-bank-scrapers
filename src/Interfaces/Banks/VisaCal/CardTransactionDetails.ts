import type { CurrencySymbol } from '../../../Scrapers/VisaCal/VisaCalBaseTypes';
import type { ICardApiStatus } from './CardApiStatus';
import type { IScrapedTransaction } from './ScrapedTransaction';

export interface ICardTransactionDetails extends ICardApiStatus {
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
        transactions: IScrapedTransaction[];
      }[];
      immidiateDebits: { totalDebits: []; debitDays: [] };
    }[];
    blockedCardInd: boolean;
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}
