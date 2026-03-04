import type { CurrencySymbol } from '../VisaCalBaseTypes';
import type { CardApiStatus } from './CardApiStatus';
import type { ScrapedTransaction } from './ScrapedTransaction';

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
