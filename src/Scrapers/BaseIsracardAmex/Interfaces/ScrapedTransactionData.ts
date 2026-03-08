import type { ScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions.js';

export interface ScrapedTransactionData {
  Header?: { Status: string };
  PirteyIska_204Bean?: { sector: string };
  CardsTransactionsListBean?: Record<
    string,
    { CurrentCardTransactions: ScrapedCurrentCardTransactions[] }
  >;
}
