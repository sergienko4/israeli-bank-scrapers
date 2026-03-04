import type { ScrapedTransaction } from './ScrapedTransaction';

export interface ScrapedCurrentCardTransactions {
  txnIsrael?: ScrapedTransaction[];
  txnAbroad?: ScrapedTransaction[];
}
