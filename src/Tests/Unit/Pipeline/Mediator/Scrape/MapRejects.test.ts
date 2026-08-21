/**
 * Mapper-reject counting — the guardrail that catches rows a bank shape found
 * and the mapper then discarded.
 *
 * The cases below pin the arithmetic and, more importantly, the *silence*: the
 * signal is only worth emitting because every healthy bank scores zero, so a
 * regression that made it chatty would make it useless. No PII: counts only.
 */

import { reportMapRejects } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/MapRejects.js';

/**
 * Run one mapping round with a fixed label.
 * @param extracted - Rows the shape handed to the mapper.
 * @param mapped - Rows the mapper accepted.
 * @returns Reject counts.
 */
function report(extracted: number, mapped: number): ReturnType<typeof reportMapRejects> {
  return reportMapRejects({ extracted, mapped, label: 'test/txns' });
}

describe('CoverageAudit/reportMapRejects', () => {
  it('reports no rejects when the mapper read every row', () => {
    const result = report(12, 12);
    expect(result).toStrictEqual({ extracted: 12, mapped: 12, rejected: 0 });
  });

  it('counts the rows the mapper refused', () => {
    const result = report(12, 5);
    expect(result.rejected).toBe(7);
  });

  it('stays silent for a shape that extracted nothing', () => {
    const result = report(0, 0);
    expect(result.rejected).toBe(0);
  });

  it('reports every row rejected when the mapper read none', () => {
    const result = report(9, 0);
    expect(result).toStrictEqual({ extracted: 9, mapped: 9 - 9, rejected: 9 });
  });

  it('never reports a negative count for a well-formed round', () => {
    const rounds = [report(1, 1), report(40, 40), report(3, 2)];
    const isNonNegative = rounds.every(r => r.rejected >= 0);
    expect(isNonNegative).toBe(true);
  });
});
