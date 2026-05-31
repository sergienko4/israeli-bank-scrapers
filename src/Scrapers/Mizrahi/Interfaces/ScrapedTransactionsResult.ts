import type { IScrapedTransaction } from './ScrapedTransaction.js';

export interface IScrapedTransactionsResult {
  header: {
    success: boolean;
    messages: { text: string }[];
  };
  body: {
    fields: {
      Yitra: string;
    };
    table: {
      rows: IScrapedTransaction[];
    };
  };
}
