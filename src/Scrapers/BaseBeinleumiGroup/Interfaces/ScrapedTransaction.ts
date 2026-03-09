import type { TransactionStatuses } from '../../../Transactions.js';

export interface IScrapedTransaction {
  reference: string;
  date: string;
  credit: string;
  debit: string;
  memo?: string;
  description: string;
  status: TransactionStatuses;
}
