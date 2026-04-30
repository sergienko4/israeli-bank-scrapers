/**
 * Unit tests for Strategy/Scrape/Monthly/MonthlyMerge — per-account merging.
 */

import { mergeAccounts } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthlyMerge.js';
import type { ITransaction, ITransactionsAccount } from '../../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../../Transactions.js';

/**
 * Build a transaction with a specific date.
 * @param date - ISO date.
 * @returns ITransaction.
 */
function makeTxn(date: string): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'shop',
    status: TransactionStatuses.Completed,
    identifier: date,
  };
}

/**
 * Build an account.
 * @param num - Account number.
 * @param txns - Transactions.
 * @returns Account.
 */
function makeAccount(num: string, txns: ITransaction[]): ITransactionsAccount {
  return { accountNumber: num, balance: 0, txns };
}

describe('mergeAccounts', () => {
  it('returns empty array for empty input', () => {
    const mergeAccountsResult1 = mergeAccounts([]);
    expect(mergeAccountsResult1).toEqual([]);
  });

  it('keeps single-account input unchanged in length', () => {
    const a = makeAccount('111', [makeTxn('2026-01-01')]);
    const result = mergeAccounts([a]);
    expect(result).toHaveLength(1);
  });

  it('merges transactions across same accountNumber', () => {
    const a = makeAccount('111', [makeTxn('2026-01-01')]);
    const b = makeAccount('111', [makeTxn('2026-02-01')]);
    const result = mergeAccounts([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].txns).toHaveLength(2);
  });

  it('preserves distinct accounts', () => {
    const a = makeAccount('111', [makeTxn('2026-01-01')]);
    const b = makeAccount('222', [makeTxn('2026-02-01')]);
    const result = mergeAccounts([a, b]);
    expect(result).toHaveLength(2);
  });

  it('uses latest balance from same-numbered accounts', () => {
    const a: ITransactionsAccount = { accountNumber: '111', balance: 10, txns: [] };
    const b: ITransactionsAccount = { accountNumber: '111', balance: 20, txns: [] };
    const result = mergeAccounts([a, b]);
    expect(result[0].balance).toBe(20);
  });
});
