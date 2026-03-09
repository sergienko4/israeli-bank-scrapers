import type { IScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions.js';

export interface IScrapedTransactionData {
  Header?: { Status: string };
  PirteyIska_204Bean?: { sector: string };
  CardsTransactionsListBean?: Record<
    string,
    { CurrentCardTransactions: IScrapedCurrentCardTransactions[] }
  >;
}
