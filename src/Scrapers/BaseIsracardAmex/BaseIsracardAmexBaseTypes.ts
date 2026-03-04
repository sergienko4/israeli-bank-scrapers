import type { TransactionsAccount } from '../../Transactions';

export type ScrapedAccountsWithIndex = Record<string, TransactionsAccount & { index: number }>;
