/**
 * Monthly merge — account merging across months for monthly scrape.
 * Extracted from MonthlyScrapeFactory.ts to respect max-lines.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import type { Brand } from '../../../Types/Brand.js';

type DidMerge = Brand<boolean, 'MonthlyDidMerge'>;

/**
 * Add an account to the merge map — merges txns for same accountNumber.
 * @param map - Mutable map of accountNumber to merged account.
 * @param acct - Account to merge in.
 * @returns True after merging.
 */
function mergeOneAccount(
  map: Map<string, ITransactionsAccount>,
  acct: ITransactionsAccount,
): DidMerge {
  const existing = map.get(acct.accountNumber);
  const prevTxns = existing?.txns ?? [];
  const merged: ITransactionsAccount = {
    accountNumber: acct.accountNumber,
    balance: acct.balance,
    txns: [...prevTxns, ...acct.txns],
  };
  map.set(acct.accountNumber, merged);
  return true as DidMerge;
}

/**
 * Merge accounts with the same accountNumber across months.
 * @param allAccounts - Flat list of accounts from all months.
 * @returns Merged accounts — one per accountNumber with combined txns.
 */
function mergeAccounts(
  allAccounts: readonly ITransactionsAccount[],
): readonly ITransactionsAccount[] {
  const map = new Map<string, ITransactionsAccount>();
  for (const acct of allAccounts) mergeOneAccount(map, acct);
  return [...map.values()];
}

export default mergeAccounts;
export { mergeAccounts };
