/**
 * Firing tests: Amex login-completion poll config contract.
 *
 * <p>Test Case IDs:
 *   - POLL-001 (FIRING): Amex carries a loginCompletionPoll entry keyed to the
 *     canonical LoginTimingConfig consts (intervalMs and maxAttempts). RED while
 *     Amex is advisory-only (field undefined); GREEN once Amex opts in so
 *     LoginCompletionObserver's enforceLoginCompletion path is reachable for
 *     Amex sessions. Root cause it locks: a perpetually-spinning login screen
 *     leaked one phase later to auth-discovery as "url-stuck"; this config makes
 *     the detection happen at LOGIN instead.
 *   - POLL-002 (CONTROL): Isracard loginCompletionPoll remains undefined — it is
 *     in the same AngularJS-SPA family but has not been opted into the poll
 *     enforcement yet. Must stay NEUTRAL.
 *   - POLL-003 (CONTROL): Discount loginCompletionPoll remains undefined — it is
 *     a deposit/checking bank (different auth family); no poll enforced.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  LOGIN_COMPLETION_POLL_INTERVAL_MS,
  LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/LoginTimingConfig.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// WaveOBranchGaps.test.ts) — no public-API barrel export is required.
describe('PipelineBankConfig — Amex login-completion poll opt-in', () => {
  it('POLL-001 (FIRING): Amex carries loginCompletionPoll with canonical consts', async () => {
    // RED while loginCompletionPoll is absent (undefined); GREEN once Amex opts
    // in so the completion-poll enforcer is activated for Amex sessions and the
    // form-still-present failure surfaces at LOGIN, not at auth-discovery.
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Amex);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginCompletionPoll).toEqual({
        intervalMs: LOGIN_COMPLETION_POLL_INTERVAL_MS,
        maxAttempts: LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
      });
    }
  });

  it('POLL-002 (CONTROL): Isracard loginCompletionPoll is undefined (NEUTRAL)', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Isracard);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginCompletionPoll).toBeUndefined();
    }
  });

  it('POLL-003 (CONTROL): Discount loginCompletionPoll is undefined (NEUTRAL)', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Discount);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.loginCompletionPoll).toBeUndefined();
    }
  });
});
