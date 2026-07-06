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
  it('ZAG-1 fails a scrape that resolved zero accounts', () => {
    const input = summary(0, 0);
    const result = zeroAccountsGuard(input);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('ZAG-2 passes a scrape with one account and transactions', () => {
    const input = summary(1, 3);
    const result = zeroAccountsGuard(input);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('ZAG-3 passes a healthy-empty account (>=1 account, zero transactions)', () => {
    const input = summary(2, 0);
    const result = zeroAccountsGuard(input);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });
});
