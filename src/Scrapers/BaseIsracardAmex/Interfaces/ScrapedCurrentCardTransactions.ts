import type { ScrapedTransaction } from './ScrapedTransaction.js';

export interface ScrapedCurrentCardTransactions {
  txnIsrael?: ScrapedTransaction[];
  txnAbroad?: ScrapedTransaction[];
}
