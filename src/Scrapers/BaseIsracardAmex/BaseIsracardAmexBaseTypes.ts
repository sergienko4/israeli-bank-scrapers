import type { ITransactionsAccount } from '../../Transactions';

export type ScrapedAccountsWithIndex = Record<string, ITransactionsAccount & { index: number }>;
