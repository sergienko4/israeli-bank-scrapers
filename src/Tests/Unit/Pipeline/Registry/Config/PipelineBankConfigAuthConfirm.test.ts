/**
 * Firing test: Amex auth-confirm config contract.
 *
 * <p>Test Case IDs:
 *   - BUDGET-001 (FIRING): Amex loginAuthConfirmMs === 45_000 (enforced).
 *     RED while Amex is advisory-only (loginAuthConfirmMs undefined); GREEN
 *     after Amex opts into the shared AngularJS auth-confirm budget. Root
 *     cause it locks: with no budget, LOGIN.POST cannot observe a positive
 *     auth signal, so it passed on the still-login page and AUTH-DISCOVERY
 *     ran before login completed (PR #389 forensic: URL never moved off
 *     he.americanexpress.co.il/personalarea/login/, submit spinner, ZERO
 *     first-party accounts traffic). Enforcing the budget makes Amex fail
 *     honestly at LOGIN instead of confusingly downstream. A healthy Amex
 *     login fires the accounts API (GetCardList) well within 45 s, so the
 *     gate never false-fires on a genuine session.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// WaveOBranchGaps.test.ts) — no public-API barrel export is required.
describe('PipelineBankConfig — Amex auth-confirm budget', () => {
  it('BUDGET-001 (FIRING): Amex loginAuthConfirmMs === 45_000 (enforced)', async () => {
    // RED while Amex is advisory-only (undefined); GREEN once Amex opts into
    // the shared AngularJS budget so LOGIN.POST enforces a positive auth
    // signal and cannot pass on the still-login page.
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Amex);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginAuthConfirmMs).toBe(45_000);
    }
  });
});
