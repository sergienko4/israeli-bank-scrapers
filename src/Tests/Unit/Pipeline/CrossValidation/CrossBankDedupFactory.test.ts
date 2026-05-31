/**
 * Phase G — cross-bank dedup factory test.
 *
 * <p>ONE parameterized test that walks every bank's PII-redacted
 * captured response through the production code path and validates
 * three contract invariants per bank in a single layered assertion:
 *
 * <ol>
 *   <li><b>extractTransactions</b> maps the bank's raw response into
 *     the expected number of `ITransaction` rows
 *     (`meta.expectedRecords`).</li>
 *   <li><b>detectDedupKeyFields</b> resolves the bank-shape-correct
 *     dedup-key tuple
 *     (`meta.expectedDedupKeyFields`). Banks with a per-txn unique
 *     identifier (Hapoalim/Isracard/Amex/VisaCal/Max/Discount)
 *     resolve `['identifier']`. Beinleumi — where `reference` is a
 *     transaction-TYPE code shared across recurring monthly txns —
 *     resolves `['date','identifier','originalAmount']`.</li>
 *   <li><b>deduplicateTxns</b> using the resolved key emits the
 *     correct unique count (`meta.expectedUniqueCount`). Beinleumi:
 *     38; today the identifier-only hash collapses to 11. Other 6
 *     banks: unique count equals captured-data baseline.</li>
 * </ol>
 *
 * <p>RED state on `main` (cbd588d3): assertion (2) imports a
 * detector module that does not yet exist → the test suite fails to
 * load. After Phase G's atomic commit lands, the detector exists,
 * the test suite loads, and all 7 rows assert GREEN.
 *
 * <p>This single factory test replaces what was originally drafted
 * as three separate test files (per-bank Beinleumi replay +
 * detector unit + cross-bank replay). User-locked 2026-05-14:
 * one factory covers all banks; no per-bank files.
 */

import detectDedupKeyFields from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DedupKeyFieldsDetector.js';
import { extractTransactions } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import {
  deduplicateTxns,
  parseStartDate,
} from '../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.js';
import {
  makeBankFixture,
  PHASE_G_BANKS,
  type PhaseGBank,
} from '../Strategy/Scrape/Fixtures/CrossBankDedup/_makeBankFixture.js';

const BANK_ROWS: readonly (readonly [PhaseGBank])[] = PHASE_G_BANKS.map(
  (b): readonly [PhaseGBank] => [b] as const,
);

describe('CROSS-BANK-DEDUP-FACTORY — Phase G dedup-key contract per bank', () => {
  it.each(BANK_ROWS)(
    'crossBank_%s_FactoryReplay_ShouldResolveKeyAndPreserveUniqueCount',
    (bank): void => {
      const { capture, meta } = makeBankFixture(bank);
      const startMs = parseStartDate(meta.startDate).getTime();

      // (1) extractTransactions baseline
      const mapped = extractTransactions(capture.responseBody);
      expect(mapped).toHaveLength(meta.expectedRecords);

      // (2) detector resolves bank-shape-correct tuple
      const keyFields = detectDedupKeyFields(mapped);
      expect(keyFields).toEqual(meta.expectedDedupKeyFields);

      // (3) deduplicateTxns with resolved key emits expected unique count
      const unique = deduplicateTxns(mapped, startMs, keyFields);
      expect(unique).toHaveLength(meta.expectedUniqueCount);
    },
  );
});
