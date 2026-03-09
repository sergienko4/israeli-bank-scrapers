import type { CurrencySymbol } from '../VisaCalBaseTypes.js';
import type { ICardApiStatus } from './CardApiStatus.js';
import type { IScrapedTransaction } from './ScrapedTransaction.js';

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
