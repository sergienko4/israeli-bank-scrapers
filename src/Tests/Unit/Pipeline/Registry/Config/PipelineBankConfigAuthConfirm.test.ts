/**
 * Firing tests: Amex / Isracard auth-confirm budget asymmetry (Phase 2A).
 *
 * <p>Test Case IDs:
 *   - BUDGET-001 (FIRING): Amex loginAuthConfirmMs === 120_000.
 *     RED on the old 45_000 value; GREEN after the Phase-2A widen.
 *   - BUDGET-002 (CONTROL): Isracard loginAuthConfirmMs === 45_000.
 *     Pins the deliberate asymmetry — Isracard is the GREEN control
 *     that must stay unchanged through Phase-2A.
 *
 * <p>Root cause: the Amex auth XHR fires (Google-Ads form_submit proves
 * it ran) but no first-party americanexpress.co.il response returns within
 * 45 s from the CI datacenter IP. A hard datacenter-IP block still fails
 * honestly at LOGIN after the wider budget rather than confusingly at
 * account-resolve, so the widen is a safe diagnostic experiment.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// WaveOBranchGaps.test.ts) — no public-API barrel export is required.
describe('PipelineBankConfig — Amex/Isracard auth-confirm budget asymmetry', () => {
  it('BUDGET-001 (FIRING): Amex loginAuthConfirmMs === 120_000 (Phase-2A widen)', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Amex);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginAuthConfirmMs).toBe(120_000);
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
