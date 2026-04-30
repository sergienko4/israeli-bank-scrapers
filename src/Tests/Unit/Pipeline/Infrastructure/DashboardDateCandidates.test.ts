/**
 * Unit tests for DashboardDateCandidates — runtime today-date candidate builder.
 * Covers format count and presence of different separator styles.
 */

import buildDateCandidates from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDateCandidates.js';

describe('buildDateCandidates', () => {
  it('returns a non-empty candidate array', () => {
    const candidates = buildDateCandidates();
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('returns 9 candidates (3 formats × 3 separators)', () => {
    const candidates = buildDateCandidates();
    expect(candidates.length).toBe(9);
  });

  it('marks every candidate as textContent kind', () => {
    const candidates = buildDateCandidates();
    const isAllText = candidates.every(c => c.kind === 'textContent');
    expect(isAllText).toBe(true);
  });

  it('emits dot, slash and dash separator variants', () => {
    const candidates = buildDateCandidates();
    const hasDot = candidates.some(c => c.value.includes('.'));
    const hasSlash = candidates.some(c => c.value.includes('/'));
    const hasDash = candidates.some(c => c.value.includes('-'));
    expect(hasDot).toBe(true);
    expect(hasSlash).toBe(true);
    expect(hasDash).toBe(true);
  });

  it('includes at least one four-digit year format', () => {
    const candidates = buildDateCandidates();
    const getFullYearResult1 = new Date().getFullYear();
    const fullYear = String(getFullYearResult1);
    const hasFull = candidates.some(c => c.value.endsWith(fullYear));
    expect(hasFull).toBe(true);
  });
});
