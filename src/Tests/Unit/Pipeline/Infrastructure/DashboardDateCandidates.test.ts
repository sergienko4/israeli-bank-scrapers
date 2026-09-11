/**
 * Unit tests for DashboardDateCandidates — runtime today-date candidate builder.
 * Covers format count and presence of different separator styles.
 */

import { jest } from '@jest/globals';

import buildDateCandidates from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDateCandidates.js';

/**
 * Make host-local date components disagree with the represented instant.
 * @param run - Candidate probe.
 * @returns Probe result.
 */
function withTamperedHostDate<T>(run: () => T): T {
  const yearSpy = jest.spyOn(Date.prototype, 'getFullYear');
  const monthSpy = jest.spyOn(Date.prototype, 'getMonth');
  const daySpy = jest.spyOn(Date.prototype, 'getDate');
  yearSpy.mockReturnValue(1999);
  monthSpy.mockReturnValue(0);
  daySpy.mockReturnValue(9);
  try {
    return run();
  } finally {
    yearSpy.mockRestore();
    monthSpy.mockRestore();
    daySpy.mockRestore();
  }
}

describe('buildDateCandidates', () => {
  it('uses the browser bank date when host components disagree', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-28T22:30:00.000Z'));
      const candidates = withTamperedHostDate(buildDateCandidates);
      const values = candidates.map(candidate => candidate.value);
      expect(values).toContain('01/03/2026');
    } finally {
      jest.useRealTimers();
    }
  });

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
