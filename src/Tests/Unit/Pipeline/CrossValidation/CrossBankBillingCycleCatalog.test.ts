/**
 * Cross-bank factory tests for the Phase-E billing-cycle catalog.
 *
 * <p>Two parameterised suites — same method, two scenarios:
 * <ul>
 *   <li>Cycling banks (Isracard / Max / VisaCal) — the detector MUST
 *       emit a typed {@link IBillingCycleCatalog} via {@link some}, and
 *       the catalog MUST include exactly one open cycle.</li>
 *   <li>Non-cycling banks (Discount / Hapoalim) — the detector MUST
 *       return {@link none} so downstream SCRAPE falls back to month-
 *       chunk iteration. Confirms zero-regression for current-account
 *       scrapers.</li>
 * </ul>
 *
 * <p>Fixtures are PII-redacted local captures (see
 * {@link BankFixtureFactory}). Test naming follows
 * `Method_Scenario_ExpectedBehavior` per
 * `testing-organization-guidlines.md`. IDs (`SHAPE-DETECT-001` etc.)
 * follow the project's existing prefix convention so failing outputs
 * are scannable in CI logs.
 *
 * <p>Commit 1 ships this file RED on current main — the detector
 * stub returns {@link none} for every input. Commit 4 lands the
 * shape recognisers (Backbase / Max / VisaCal) and flips the cycling
 * scenario GREEN; the non-cycling scenario passes throughout.
 */

import { detectBillingCycleCatalog } from '../../../../Scrapers/Pipeline/Mediator/AccountResolve/BillingCycleCatalogDetector.js';
import { isSome, type Option } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBillingCycleCatalog } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  CYCLING_BANKS,
  type CyclingBank,
  makeBankFixture,
  NON_CYCLING_BANKS,
  type NonCyclingBank,
} from './Fixtures/CrossBank/BankFixtureFactory.js';

/**
 * Predicate — returns `true` when the option carries a typed catalog
 * with at least one cycle and exactly one OPEN cycle. Asserted by the
 * cycling-bank rows.
 *
 * @param option - The Option returned by the detector.
 * @returns True when the catalog is present and shaped correctly.
 */
function isValidCyclingCatalog(option: Option<IBillingCycleCatalog>): boolean {
  if (!isSome(option)) return false;
  const catalog = option.value;
  if (catalog.cycles.length === 0) return false;
  const openCycles = catalog.cycles.filter((c): boolean => c.isOpen);
  return openCycles.length === 1;
}

describe('CrossBankBillingCycleCatalog — Factory 1: banks WITH cycle catalog', () => {
  it.each(CYCLING_BANKS)(
    '[SHAPE-DETECT-CYCLING] BillingCycleCatalogDetector_%sPreNavBuffer_ShouldEmitTypedCatalog',
    (bank: CyclingBank) => {
      const fixture = makeBankFixture(bank);
      const result = detectBillingCycleCatalog(fixture.prenavBuffer);
      const isValid = isValidCyclingCatalog(result);
      expect(isValid).toBe(true);
    },
  );
});

describe('CrossBankBillingCycleCatalog — Factory 2: banks WITHOUT cycle catalog', () => {
  it.each(NON_CYCLING_BANKS)(
    '[SHAPE-DETECT-NONE] BillingCycleCatalogDetector_%sPreNavBuffer_ShouldReturnNone',
    (bank: NonCyclingBank) => {
      const fixture = makeBankFixture(bank);
      const result = detectBillingCycleCatalog(fixture.prenavBuffer);
      expect(result.has).toBe(false);
    },
  );
});
