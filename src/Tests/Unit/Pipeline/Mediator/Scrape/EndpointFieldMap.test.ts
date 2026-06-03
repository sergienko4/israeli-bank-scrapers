/**
 * Edge-case unit tests for {@link resolveFieldMapOrEmpty} — the slim
 * field-map resolver extracted under
 * `Mediator/Scrape/EndpointResolver/EndpointFieldMap.ts` during the
 * Phase 2e file-split work. These cases close the branch gaps that
 * the cross-bank ResolveTxnEndpoint fixture suite cannot reach:
 *
 * <ul>
 *   <li>empty `records` array → returns the EMPTY_FIELD_MAP
 *       sentinel (no records to sample);</li>
 *   <li>sample without a date alias → buildFieldMap returns
 *       `false` and resolveFieldMapOrEmpty falls back to the
 *       EMPTY_FIELD_MAP sentinel;</li>
 *   <li>sample with neither `amount` nor `creditAmount`/`debitAmount`
 *       aliases → buildFieldMap returns `false` (no amount column);</li>
 *   <li>sample with `creditAmount` only → pickAmountAlias falls back
 *       to the credit branch (not the direct WK.amount alias);</li>
 *   <li>sample with `debitAmount` only → pickAmountAlias falls back
 *       to the debit branch.</li>
 * </ul>
 *
 * Per `test-guidlines.md` "unit test for edge cases only" — this is
 * an additive Phase 2 strict-lockdown branch-coverage closure, no
 * existing tests modified.
 */

import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import resolveFieldMapOrEmpty from '../../../../../Scrapers/Pipeline/Mediator/Scrape/EndpointResolver/EndpointFieldMap.js';

/** Sentinel returned when the resolver cannot derive a usable map. */
const EMPTY_FIELD_MAP = {
  date: '',
  amount: '',
  description: '',
  currency: '',
  identifier: '',
  originalAmount: false,
  processedDate: false,
  balance: false,
} as const;

describe('resolveFieldMapOrEmpty — empty input', () => {
  it('returns EMPTY_FIELD_MAP when the records array is empty', () => {
    const out = resolveFieldMapOrEmpty([]);
    expect(out).toEqual(EMPTY_FIELD_MAP);
  });
});

describe('resolveFieldMapOrEmpty — buildFieldMap false fallback', () => {
  it('returns EMPTY_FIELD_MAP when the sample has no date alias', () => {
    const sample: ApiRecord = { amount: 5, description: 'x' };
    const out = resolveFieldMapOrEmpty([sample]);
    expect(out).toEqual(EMPTY_FIELD_MAP);
  });

  it('returns EMPTY_FIELD_MAP when the sample has no amount-style alias', () => {
    const sample: ApiRecord = { date: '2026-06-03', description: 'x' };
    const out = resolveFieldMapOrEmpty([sample]);
    expect(out).toEqual(EMPTY_FIELD_MAP);
  });
});

describe('resolveFieldMapOrEmpty — pickAmountAlias fallbacks', () => {
  it('falls back to creditAmount when WK.amount is absent', () => {
    const sample: ApiRecord = { date: '2026-06-03', creditAmount: 12 };
    const out = resolveFieldMapOrEmpty([sample]);
    expect(out.date).toBe('date');
    expect(out.amount).toBe('creditAmount');
  });

  it('falls back to debitAmount when WK.amount and creditAmount are both absent', () => {
    const sample: ApiRecord = { date: '2026-06-03', debitAmount: 7 };
    const out = resolveFieldMapOrEmpty([sample]);
    expect(out.date).toBe('date');
    expect(out.amount).toBe('debitAmount');
  });
});
