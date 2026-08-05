/**
 * Behaviour contract for the PayBox fail-closed scrape guard.
 *
 * <p>This guard is the only thing standing between a broken PayBox
 * scrape and a SILENT `success([])` that looks identical to an empty
 * wallet. Before this suite the guard had no behavioural coverage at
 * all — `PayBoxShape.test.ts` asserted only that `resultGuard` is a
 * function — so every predicate branch was unpinned.
 *
 * <p>T-PBG-1 encodes the exact summary observed in the failing CI run
 * (one account, zero transactions, balance step degraded). T-PBG-3
 * encodes the last known-green run (88 transactions with the same
 * degraded balance step) and asserts the guard stays silent there, so a
 * future tightening cannot start failing healthy scrapes.
 */
import {
  PAYBOX_DEGRADED_SCRAPE_MSG,
  payBoxResultGuard,
} from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxResultGuard.js';
import type { IApiDirectScrapeGuardSummary } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';

/**
 * Build a guard summary, defaulting to the healthy shape.
 * @param over - Fields to override on the healthy baseline.
 * @returns Summary accepted by the guard.
 */
function summaryOf(over: Partial<IApiDirectScrapeGuardSummary>): IApiDirectScrapeGuardSummary {
  return { accountCount: 1, totalTxns: 5, balanceDegraded: false, ...over };
}

describe('payBoxResultGuard', () => {
  it('T-PBG-1: fails on the observed CI signature (1 acct, 0 txns, degraded)', () => {
    const observed = summaryOf({ totalTxns: 0, balanceDegraded: true });

    const result = payBoxResultGuard(observed);
    const message = result.success ? '' : result.errorMessage;

    expect(result.success).toBe(false);
    expect(message).toBe(PAYBOX_DEGRADED_SCRAPE_MSG);
  });

  it('T-PBG-2: passes a healthy empty wallet (0 txns, balance NOT degraded)', () => {
    const healthyEmpty = summaryOf({ totalTxns: 0, balanceDegraded: false });

    const result = payBoxResultGuard(healthyEmpty);

    expect(result.success).toBe(true);
  });

  it('T-PBG-3: passes the known-green shape (many txns, balance degraded)', () => {
    const knownGreen = summaryOf({ totalTxns: 88, balanceDegraded: true });

    const result = payBoxResultGuard(knownGreen);

    expect(result.success).toBe(true);
  });

  it('T-PBG-4: passes zero accounts — that case belongs to zeroAccountsGuard', () => {
    const noAccounts = summaryOf({ accountCount: 0, totalTxns: 0, balanceDegraded: true });

    const result = payBoxResultGuard(noAccounts);

    expect(result.success).toBe(true);
  });

  it('T-PBG-5: fires regardless of how many accounts carry the empty result', () => {
    const manyEmpty = summaryOf({ accountCount: 4, totalTxns: 0, balanceDegraded: true });

    const result = payBoxResultGuard(manyEmpty);

    expect(result.success).toBe(false);
  });

  it('T-PBG-6: operator message names no cause the guard cannot observe', () => {
    // The guard sees only summary counters, so it can say nothing about
    // the token — not that it is degraded, valid, or anything else.
    expect(PAYBOX_DEGRADED_SCRAPE_MSG).not.toMatch(/token/i);
    // Nor whether a fresh login clears the signature — and run
    // 31015484475 proves it does not. Any re-auth claim would be unfounded.
    expect(PAYBOX_DEGRADED_SCRAPE_MSG).not.toMatch(/re-?auth/i);
    expect(PAYBOX_DEGRADED_SCRAPE_MSG).toMatch(/respLength|errorCode/);
  });

  it('T-PBG-7: operator message carries no digit run resembling an account', () => {
    expect(PAYBOX_DEGRADED_SCRAPE_MSG).not.toMatch(/\d{3,}/);
  });
});
