/**
 * Default fail-closed scrape guard — unit coverage for {@link zeroAccountsGuard}.
 * Proves it fails a zero-account scrape (invalid post-login session) while a
 * scrape with at least one account passes, INCLUDING a healthy-empty account
 * (>=1 account, zero transactions) — the guard keys on accounts, never on
 * transactions, so an empty-but-valid account is never a false positive.
 */

import type { IApiDirectScrapeGuardSummary } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { zeroAccountsGuard } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ZeroAccountsGuard.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a PII-free guard summary with the given account + transaction counts.
 * @param accountCount - Resolved account count.
 * @param totalTxns - Total transactions across all accounts.
 * @returns Guard summary (never degraded).
 */
function summary(accountCount: number, totalTxns: number): IApiDirectScrapeGuardSummary {
  return { accountCount, totalTxns, balanceDegraded: false };
}

describe('zeroAccountsGuard', () => {
  it.each([
    {
      name: 'ZAG-1 fails a scrape that resolved zero accounts',
      accountCount: 0,
      totalTxns: 0,
      isPass: false,
    },
    {
      name: 'ZAG-2 passes a scrape with one account and transactions',
      accountCount: 1,
      totalTxns: 3,
      isPass: true,
    },
    {
      name: 'ZAG-3 passes a healthy-empty account (>=1 account, zero transactions)',
      accountCount: 2,
      totalTxns: 0,
      isPass: true,
    },
  ])('$name', ({ accountCount, totalTxns, isPass }) => {
    const input = summary(accountCount, totalTxns);
    const result = zeroAccountsGuard(input);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(isPass);
  });
});
