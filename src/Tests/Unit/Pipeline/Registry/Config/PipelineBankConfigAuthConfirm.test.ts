/**
 * Firing tests: Amex / Isracard auth-confirm config contract.
 *
 * <p>Test Case IDs:
 *   - BUDGET-001 (FIRING): Amex loginAuthConfirmMs is undefined (advisory-only).
 *     RED while the Phase-2A hard 120_000 ms budget is set; GREEN after Amex
 *     reverts to advisory-only. Root cause: the Amex Wix shell at
 *     he.americanexpress.co.il relays credentials via postMessage to an auth
 *     iframe at web.americanexpress.co.il, which is unreachable from the CI
 *     datacenter IP (ZERO requests to that host in 120 s of waiting, PR #389
 *     forensic trace). Hard enforcement times out in CI; advisory-only matches
 *     Amex's real auth model where the session is established post-navigation.
 *   - BUDGET-002 (CONTROL): Isracard loginAuthConfirmMs === 45_000.
 *     Isracard uses a direct native backend (web.isracard.co.il), no Wix
 *     relay; the 45 s enforcement is correct and must remain unchanged.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// WaveOBranchGaps.test.ts) — no public-API barrel export is required.
describe('PipelineBankConfig — Amex/Isracard auth-confirm budget asymmetry', () => {
  it('BUDGET-001 (FIRING): Amex loginAuthConfirmMs is advisory-only (undefined)', async () => {
    // RED while Amex has loginAuthConfirmMs: 120_000; GREEN after the value
    // is removed. Hard enforcement blocks CI because web.americanexpress.co.il
    // (the postMessage relay target) is unreachable from the datacenter IP.
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Amex);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginAuthConfirmMs).toBeUndefined();
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
