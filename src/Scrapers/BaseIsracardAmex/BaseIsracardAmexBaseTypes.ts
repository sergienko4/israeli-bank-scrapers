import type { TransactionsAccount } from '../../Transactions.js';

export type ScrapedAccountsWithIndex = Record<string, TransactionsAccount & { index: number }>;
