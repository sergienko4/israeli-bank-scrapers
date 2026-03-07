import type { IScrapedTransaction } from './ScrapedTransaction';

export interface IScrapedCurrentCardTransactions {
  txnIsrael?: IScrapedTransaction[];
  txnAbroad?: IScrapedTransaction[];
}
