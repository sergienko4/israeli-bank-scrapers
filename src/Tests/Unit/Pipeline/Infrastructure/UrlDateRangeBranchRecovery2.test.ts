/**
 * Branch recovery tests for UrlDateRange.
 * Targets:
 *  - line 69 path 1: ISO pattern does NOT match — fallback to YYYYMMDD default.
 *    Triggered by a URL whose date param uses a non-YMD, non-ISO shape
 *    (e.g. dd/mm/yyyy).
 */

import { applyDateRangeToUrlWithCount } from '../../../../Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.js';

describe('UrlDateRange — branch recovery', () => {
  it('line 69 path 1: non-YMD, non-ISO probe falls back to YYYYMMDD default', () => {
    // WK alias `fromDate` matches the param key; its captured shape is
    // `15/01/2026` — neither YMD nor ISO → formatLikeProbe takes the final
    // default (YYYYMMDD).
    const url = 'https://bank.example.com/txn?fromDate=15/01/2026&toDate=20/01/2026';
    const from = new Date('2026-02-15T00:00:00Z');
    const to = new Date('2026-02-20T00:00:00Z');
    const outcome = applyDateRangeToUrlWithCount(url, from, to);
    expect(outcome.swapped).toBe(2);
    // Default format is YYYYMMDD (8 digits).
    expect(outcome.url).toMatch(/fromDate=\d{8}/);
    expect(outcome.url).toMatch(/toDate=\d{8}/);
  });

  it('preserves ISO shape when probe is `YYYY-MM-DD`', () => {
    const url = 'https://bank.example.com/txn?fromDate=2026-01-15&toDate=2026-01-20';
    const from = new Date('2026-02-15T00:00:00Z');
    const to = new Date('2026-02-20T00:00:00Z');
    const outcome = applyDateRangeToUrlWithCount(url, from, to);
    expect(outcome.swapped).toBe(2);
    expect(outcome.url).toMatch(/fromDate=\d{4}-\d{2}-\d{2}/);
  });
});
