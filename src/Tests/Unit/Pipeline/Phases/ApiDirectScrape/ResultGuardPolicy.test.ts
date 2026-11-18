/**
 * One shared result-guard policy: a bank declares its extra checks as data,
 * and the phase composes the universal zero-account floor ahead of it.
 */

import type { IApiDirectScrapeGuardSummary } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import resultGuardFromPolicy from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ResultGuardPolicy.js';

/**
 * Build a PII-free guard summary.
 * @param overrides - Signals to change for the case.
 * @returns Guard input.
 */
function summary(
  overrides: Partial<IApiDirectScrapeGuardSummary> = {},
): IApiDirectScrapeGuardSummary {
  return {
    accountCount: 1,
    totalTxns: 0,
    balanceDegraded: false,
    observedCaveats: [],
    ...overrides,
  };
}

describe('resultGuardFromPolicy', () => {
  it('passes when the policy declares no extra checks', () => {
    const guard = resultGuardFromPolicy({});
    const input = summary();
    const result = guard(input);
    expect(result.success).toBe(true);
  });

  it('refuses a degraded balance when complete evidence is required', () => {
    const guard = resultGuardFromPolicy({
      requireCompleteEvidence: true,
      incompleteMessage: 'incomplete',
    });
    const input = summary({ balanceDegraded: true });
    const result = guard(input);
    expect(result).toMatchObject({ success: false, errorMessage: 'incomplete' });
  });

  it('refuses unavailable caveats when complete evidence is required', () => {
    const guard = resultGuardFromPolicy({
      requireCompleteEvidence: true,
      incompleteMessage: 'incomplete',
    });
    const input = summary({ observedCaveats: undefined });
    const result = guard(input);
    expect(result).toMatchObject({ success: false, errorMessage: 'incomplete' });
  });

  it.each(['declaredRowShortfall', 'extractionShortfall', 'mappingRejectedRows'] as const)(
    'refuses observed %s',
    caveat => {
      const guard = resultGuardFromPolicy({
        lossCaveats: ['declaredRowShortfall', 'extractionShortfall', 'mappingRejectedRows'],
        lossMessage: 'loss',
      });
      const input = summary({ observedCaveats: [caveat] });
      const result = guard(input);
      expect(result).toMatchObject({ success: false, errorMessage: 'loss' });
    },
  );

  it('passes caveats outside the loss list', () => {
    const guard = resultGuardFromPolicy({
      lossCaveats: ['declaredRowShortfall'],
      lossMessage: 'loss',
    });
    const input = summary({ observedCaveats: ['declaredRowAuditUnavailable'] });
    const result = guard(input);
    expect(result.success).toBe(true);
  });

  it('refuses the degraded-empty signature when configured', () => {
    const guard = resultGuardFromPolicy({
      failOnDegradedEmpty: true,
      degradedEmptyMessage: 'degraded empty',
    });
    const input = summary({ totalTxns: 0, balanceDegraded: true });
    const result = guard(input);
    expect(result).toMatchObject({ success: false, errorMessage: 'degraded empty' });
  });

  it('returns incomplete evidence before loss when both checks fail', () => {
    const guard = resultGuardFromPolicy({
      requireCompleteEvidence: true,
      incompleteMessage: 'incomplete',
      lossCaveats: ['mappingRejectedRows'],
      lossMessage: 'loss',
    });
    const input = summary({ balanceDegraded: true, observedCaveats: ['mappingRejectedRows'] });
    const result = guard(input);
    expect(result).toMatchObject({ success: false, errorMessage: 'incomplete' });
  });

  it('passes a healthy empty wallet', () => {
    const guard = resultGuardFromPolicy({
      failOnDegradedEmpty: true,
      degradedEmptyMessage: 'degraded empty',
    });
    const input = summary({ totalTxns: 0, balanceDegraded: false });
    const result = guard(input);
    expect(result.success).toBe(true);
  });
});
