/**
 * Generic URL query-param date-range patcher — unit tests.
 *
 * Verifies applyDateRangeToUrl rewrites WK-known query params
 * (fromDate/toDate aliases) while leaving non-matching URLs intact.
 * Format-preserving: YYYYMMDD in -> YYYYMMDD out; ISO in -> ISO out.
 */
import {
  applyDateRangeAndAppend,
  applyDateRangeAndAppendWithCount,
  applyDateRangeToUrl,
  applyDateRangeToUrlWithCount,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.js';

const FROM = new Date('2025-04-21T00:00:00Z');
const TO = new Date('2026-04-20T00:00:00Z');

describe('applyDateRangeToUrl — Hapoalim YYYYMMDD shape', () => {
  it('rewrites retrievalStartDate / retrievalEndDate', () => {
    const url =
      'https://login.bankhapoalim.co.il/ServerServices/current-account/transactions' +
      '?accountId=99-999-991234&numItemsPerPage=150' +
      '&retrievalEndDate=20260420&retrievalStartDate=20260321' +
      '&sortCode=1&lang=he';
    const out = applyDateRangeToUrl(url, FROM, TO);
    expect(out).toContain('retrievalStartDate=20250421');
    expect(out).toContain('retrievalEndDate=20260420');
    expect(out).toContain('accountId=99-999-991234');
    expect(out).toContain('sortCode=1');
  });
});

describe('applyDateRangeToUrl — Discount FromDate shape', () => {
  it('rewrites FromDate when present', () => {
    const url = 'https://discount.example/api/lastTransactions/9999999999/Date?FromDate=20260121';
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

describe("applyDateRangeAndAppend — Phase H'' detector-driven APPEND", () => {
  it('appends both missing aliases when URL lacks any WK date params', () => {
    const url = 'https://x.example/api?accountId=00-000-000000&lang=he';
    const out = applyDateRangeAndAppend(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate', 'retrievalEndDate'],
    });
    expect(out).toContain('retrievalStartDate=20250421');
    expect(out).toContain('retrievalEndDate=20260420');
    expect(out).toContain('accountId=00-000-000000');
  });

  it('leaves an existing alias untouched and appends only the missing one', () => {
    const url = 'https://x.example/api?retrievalStartDate=20260321&accountId=00-000-000000';
    const outcome = applyDateRangeAndAppendWithCount(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate', 'retrievalEndDate'],
    });
    expect(outcome.swapped).toBe(2);
    expect(outcome.url).toContain('retrievalStartDate=20250421');
    expect(outcome.url).toContain('retrievalEndDate=20260420');
  });

  it('appends only fromAlias when toAlias is already present', () => {
    const url = 'https://x.example/api?retrievalEndDate=20260420&accountId=00-000-000000';
    const outcome = applyDateRangeAndAppendWithCount(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate', 'retrievalEndDate'],
    });
    expect(outcome.swapped).toBe(2);
    expect(outcome.url).toContain('retrievalStartDate=20250421');
    expect(outcome.url).toContain('retrievalEndDate=20260420');
  });

  it('is a no-op when the tuple has fewer than 2 entries', () => {
    const url = 'https://x.example/api?accountId=00-000-000000';
    const out = applyDateRangeAndAppend(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate'],
    });
    expect(out).toBe(url);
  });

  it('is a no-op when either alias in the tuple is empty-string', () => {
    const url = 'https://x.example/api?accountId=00-000-000000';
    const out = applyDateRangeAndAppend(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate', ''],
    });
    expect(out).toBe(url);
  });

  it('preserves replace-only semantics when tuple is empty', () => {
    const url = 'https://x.example/api?accountId=00-000-000000';
    const out = applyDateRangeAndAppend(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: [],
    });
    expect(out).toBe(url);
  });

  // Phase H'' (2026-05-15) — live regression guard. Hapoalim run
  // `15-05-2026_11414346` proved the bug: URL had `retrievalStartDate`
  // / `retrievalEndDate` (already WK aliases) and the detector emitted
  // tuple `['startDate', 'endDate']` (from a sibling capture body).
  // Appending the tuple's aliases on top of the URL's existing WK
  // aliases produced a conflict — bank returned 302 redirect. The
  // append step MUST skip when the URL already carries ANY WK
  // fromDate AND ANY WK toDate alias, because `applyDateRangeToUrl`
  // already substituted the date range in-place via WK matching.
  it('SKIPS append when URL already has WK fromDate + WK toDate aliases (Hapoalim 302 regression)', () => {
    const url =
      'https://login.bankhapoalim.fake.example/ServerServices/current-account/transactions' +
      '?numItemsPerPage=150&sortCode=1' +
      '&retrievalEndDate=20260515&retrievalStartDate=20260415' +
      '&accountId=00-000-000000&lang=he';
    const outcome = applyDateRangeAndAppendWithCount(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['startDate', 'endDate'],
    });
    // URL's existing aliases get rewritten by applyDateRangeToUrl.
    expect(outcome.url).toContain('retrievalStartDate=20250421');
    expect(outcome.url).toContain('retrievalEndDate=20260420');
    // The tuple aliases (startDate / endDate) MUST NOT have been
    // appended — otherwise the bank sees conflicting param schemes.
    expect(outcome.url).not.toContain('startDate=2025');
    expect(outcome.url).not.toContain('endDate=2026');
    expect(outcome.url).not.toContain('&startDate=');
    expect(outcome.url).not.toContain('&endDate=');
  });

  it('still appends when URL has ONLY a WK fromDate alias (no toDate present)', () => {
    // Defensive: if the URL has fromDate but no toDate, we still
    // append the tuple to give the caller a complete window. (Real-
    // world this is rare — banks pair both — but the test pins the
    // behaviour deliberately.)
    const url = 'https://x.example/api?fromDate=20260101&accountId=00-000-000000';
    const out = applyDateRangeAndAppend(url, {
      fromDate: FROM,
      toDate: TO,
      windowParams: ['retrievalStartDate', 'retrievalEndDate'],
    });
    expect(out).toContain('fromDate=20250421');
    expect(out).toContain('retrievalEndDate=20260420');
  });
});
