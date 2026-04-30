/**
 * Generic URL query-param date-range patcher — unit tests.
 *
 * Verifies applyDateRangeToUrl rewrites WK-known query params
 * (fromDate/toDate aliases) while leaving non-matching URLs intact.
 * Format-preserving: YYYYMMDD in -> YYYYMMDD out; ISO in -> ISO out.
 */
import {
  applyDateRangeToUrl,
  applyDateRangeToUrlWithCount,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.js';

const FROM = new Date('2025-04-21T00:00:00Z');
const TO = new Date('2026-04-20T00:00:00Z');

describe('applyDateRangeToUrl — Hapoalim YYYYMMDD shape', () => {
  it('rewrites retrievalStartDate / retrievalEndDate', () => {
    const url =
      'https://login.bankhapoalim.co.il/ServerServices/current-account/transactions' +
      '?accountId=12-170-536347&numItemsPerPage=150' +
      '&retrievalEndDate=20260420&retrievalStartDate=20260321' +
      '&sortCode=1&lang=he';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toContain('retrievalStartDate=20250421');
    expect(out).toContain('retrievalEndDate=20260420');
    expect(out).toContain('accountId=12-170-536347');
    expect(out).toContain('sortCode=1');
  });
});

describe('applyDateRangeToUrl — Discount FromDate shape', () => {
  it('rewrites FromDate when present', () => {
    const url = 'https://discount.example/api/lastTransactions/0152228812/Date?FromDate=20260121';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toContain('FromDate=20250421');
  });
});

describe('applyDateRangeToUrl — ISO date shape preservation', () => {
  it('preserves ISO YYYY-MM-DD output when input was ISO', () => {
    const url = 'https://x.example/api?startDate=2026-01-21&endDate=2026-04-20';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toContain('startDate=2025-04-21');
    expect(out).toContain('endDate=2026-04-20');
  });
});

describe('applyDateRangeToUrl — pass-through cases', () => {
  it('leaves URL unchanged when no WK date keys present', () => {
    const url = 'https://x.example/api?accountId=123&sortCode=1';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toBe(url);
  });

  it('returns input unchanged on malformed URL', () => {
    const malformed = 'not a url';
    const out = applyDateRangeToUrl(malformed, FROM, TO);
    expect(out).toBe(malformed);
  });

  it('leaves URL unchanged when search params are empty', () => {
    const url = 'https://x.example/api/x';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toBe(url);
  });
});

describe('applyDateRangeToUrlWithCount — swap counter', () => {
  it('reports 2 swaps for from+to', () => {
    const url = 'https://x.example/api?retrievalStartDate=20260321&retrievalEndDate=20260420';
    const outcome = applyDateRangeToUrlWithCount(url, FROM, TO);
    expect(outcome.swapped).toBe(2);
  });

  it('reports 0 swaps when no WK keys match', () => {
    const url = 'https://x.example/api?foo=bar';
    const outcome = applyDateRangeToUrlWithCount(url, FROM, TO);
    expect(outcome.swapped).toBe(0);
  });

  it('reports 1 swap for from-only', () => {
    const url = 'https://x.example/api?fromDate=20260321&unrelated=x';
    const outcome = applyDateRangeToUrlWithCount(url, FROM, TO);
    expect(outcome.swapped).toBe(1);
  });
});
