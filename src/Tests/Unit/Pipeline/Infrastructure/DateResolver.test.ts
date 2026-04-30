/**
 * Unit tests for DateResolver — proxy date token resolution.
 * Covers: YYYY, MM, DD, compound token expansion.
 */

import {
  resolveDateTokens,
  resolveToken,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DateResolver.js';

/** Fixed test date for deterministic output. */
const FIXED_DATE = new Date(2026, 3, 5); // April 5, 2026

describe('resolveToken', () => {
  it('replaces YYYY with four-digit year', () => {
    const result = resolveToken('YYYY', FIXED_DATE);
    expect(result).toBe('2026');
  });

  it('replaces MM with zero-padded month', () => {
    const result = resolveToken('MM', FIXED_DATE);
    expect(result).toBe('04');
  });

  it('replaces DD with zero-padded day', () => {
    const result = resolveToken('DD', FIXED_DATE);
    expect(result).toBe('05');
  });

  it('resolves compound token YYYY-MM-DD', () => {
    const result = resolveToken('YYYY-MM-DD', FIXED_DATE);
    expect(result).toBe('2026-04-05');
  });

  it('resolves compound token YYYY-MM-01 (first of month)', () => {
    const result = resolveToken('YYYY-MM-01', FIXED_DATE);
    expect(result).toBe('2026-04-01');
  });

  it('passes through literal strings with no tokens', () => {
    const result = resolveToken('literal', FIXED_DATE);
    expect(result).toBe('literal');
  });

  it('zero-pads single digit months and days', () => {
    const janFirst = new Date(2026, 0, 1);
    const result = resolveToken('YYYY-MM-DD', janFirst);
    expect(result).toBe('2026-01-01');
  });
});

describe('resolveDateTokens', () => {
  it('resolves all tokens in params record', () => {
    const params = { billingDate: 'YYYY-MM-01', day: 'DD' };
    const result = resolveDateTokens(params, FIXED_DATE);
    expect(result).toEqual({ billingDate: '2026-04-01', day: '05' });
  });

  it('returns empty object for empty input', () => {
    const result = resolveDateTokens({}, FIXED_DATE);
    expect(result).toEqual({});
  });

  it('leaves literal values unchanged', () => {
    const params = { reqName: 'staticName' };
    const result = resolveDateTokens(params, FIXED_DATE);
    expect(result).toEqual({ reqName: 'staticName' });
  });
});
