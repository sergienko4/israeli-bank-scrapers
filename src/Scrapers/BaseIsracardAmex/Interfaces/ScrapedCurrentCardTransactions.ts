import type { IScrapedTransaction } from './ScrapedTransaction.js';

export interface IScrapedCurrentCardTransactions {
  txnIsrael?: IScrapedTransaction[];
  txnAbroad?: IScrapedTransaction[];
}
