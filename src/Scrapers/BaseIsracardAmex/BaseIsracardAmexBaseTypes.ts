import type { ITransactionsAccount } from '../../Transactions.js';

export type ScrapedAccountsWithIndex = Record<string, ITransactionsAccount & { index: number }>;
