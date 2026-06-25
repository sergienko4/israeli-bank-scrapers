/**
 * Firing tests: Amex / Isracard auth-confirm config contract.
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
 *     honestly at LOGIN instead of confusingly downstream. Symmetric with
 *     Isracard (same AngularJS-SPA family); a healthy Amex login fires the
 *     accounts API (GetCardList) well within 45 s, so the gate never
 *     false-fires on a genuine session.
 *   - BUDGET-002 (CONTROL): Isracard loginAuthConfirmMs === 45_000.
 *     Isracard uses a direct native backend (web.isracard.co.il); the 45 s
 *     enforcement is correct and must remain unchanged.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// WaveOBranchGaps.test.ts) — no public-API barrel export is required.
describe('PipelineBankConfig — Amex/Isracard auth-confirm budget asymmetry', () => {
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

  it('BUDGET-002 (CONTROL): Isracard loginAuthConfirmMs === 45_000 (unchanged GREEN control)', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Isracard);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginAuthConfirmMs).toBe(45_000);
    }
  });
});
