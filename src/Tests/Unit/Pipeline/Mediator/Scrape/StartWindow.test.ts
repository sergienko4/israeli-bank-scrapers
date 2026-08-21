/**
 * Start-date window — the filter that honours the caller's `startDate` on the
 * ApiDirect path.
 *
 * The cases below pin three things the measured data made non-obvious: the
 * bound is inclusive, there is deliberately **no** upper bound (callers ask for
 * future-dated charges via `futureMonthsToScrape`), and a missing bound passes
 * rows through untouched rather than deleting them all. No PII: synthetic rows.
 */

import { parseAutoDate } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import { applyStartWindow } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/StartWindow.js';
import type { ITransaction } from '../../../../../Transactions.js';

/**
 * Build a synthetic transaction carrying only the fields the window reads.
 * @param date - ISO date string for the row.
 * @returns Transaction shaped enough for the filter.
 */
function txn(date: string): ITransaction {
  return { date, description: 'row', chargedAmount: -1 } as unknown as ITransaction;
}

/**
 * Apply the window with a fixed label.
 * @param dates - ISO dates for the rows under test.
 * @param start - ISO date for the window lower bound.
 * @returns Windowing outcome.
 */
function windowOf(dates: readonly string[], start: string): ReturnType<typeof applyStartWindow> {
  const txns = dates.map(txn);
  const startDate = new Date(start);
  return applyStartWindow({ txns, startDate, label: 'test/txns' });
}

describe('Scrape/applyStartWindow', () => {
  it('keeps rows dated after the window opens', () => {
    const result = windowOf(['2026-03-01', '2026-04-01'], '2026-02-20');
    expect(result).toStrictEqual({ kept: [txn('2026-03-01'), txn('2026-04-01')], dropped: 0 });
  });

  it('drops rows dated before the window opens', () => {
    const result = windowOf(['2025-07-26', '2026-03-01'], '2026-02-20');
    expect(result.dropped).toBe(1);
  });

  it('treats the lower bound as inclusive', () => {
    const result = windowOf(['2026-02-20'], '2026-02-20');
    expect(result.dropped).toBe(0);
  });

  it('keeps future-dated charges the caller asked for', () => {
    const result = windowOf(['2026-09-01'], '2026-02-20');
    expect(result.kept).toHaveLength(1);
  });

  it('recovers the measured Isracard split — 61 of 113 rows out of window', () => {
    const older = Array.from({ length: 61 }, () => '2025-07-26');
    const newer = Array.from({ length: 52 }, () => '2026-07-15');
    const result = windowOf([...older, ...newer], '2026-02-20');
    expect(result).toStrictEqual({ kept: newer.map(txn), dropped: 61 });
  });

  it('passes rows through when the caller supplied no bound', () => {
    const txns = ['2020-01-01'].map(txn);
    const startDate = undefined as unknown as Date;
    const result = applyStartWindow({ txns, startDate, label: 'test/txns' });
    expect(result).toStrictEqual({ kept: txns, dropped: 0 });
  });

  it('passes rows through when the bound is an unparseable date', () => {
    const txns = ['2020-01-01'].map(txn);
    const startDate = new Date('not-a-date');
    const result = applyStartWindow({ txns, startDate, label: 'test/txns' });
    expect(result.dropped).toBe(0);
  });

  it('keeps a row whose own date is unreadable rather than deleting it', () => {
    const result = windowOf(['not-a-date'], '2026-02-20');
    expect(result).toStrictEqual({ kept: [txn('not-a-date')], dropped: 0 });
  });

  it('keeps unreadable rows while still trimming the readable ones', () => {
    const result = windowOf(['2025-07-26', 'not-a-date', '2026-03-01'], '2026-02-20');
    expect(result.kept).toStrictEqual([txn('not-a-date'), txn('2026-03-01')]);
  });

  it('keeps a row the mapper dated at the epoch because it could not read it', () => {
    const result = windowOf([new Date(0).toISOString()], '2026-02-20');
    expect(result.dropped).toBe(0);
  });

  it('reports nothing dropped for an account with no transactions', () => {
    const result = windowOf([], '2026-02-20');
    expect(result).toStrictEqual({ kept: [], dropped: 0 });
  });
});

describe('Scrape/applyStartWindow on the start day itself', () => {
  it('keeps a row the mapper dated on the very day the caller asked from', () => {
    // The mapper parses a bank's `20260220` in the LOCAL zone, so the row's
    // instant is local midnight; a caller's `startDate` arrives as an ISO date
    // string and is UTC midnight. East of Greenwich the row therefore sits
    // *before* the bound while being on the exact day requested, and comparing
    // instants silently dropped a whole day of transactions from every bank.
    // The window compares calendar days so both sides speak the same units.
    //
    // The suite's zone is pinned in `jest.config.js`; without that pin this
    // case would pass vacuously on a UTC runner, where the mismatch is zero.
    const onStartDay = parseAutoDate('20260220');
    const result = windowOf([onStartDay], '2026-02-20');
    expect(result).toStrictEqual({ kept: [txn(onStartDay)], dropped: 0 });
  });

  it('still drops a row the mapper dated the day before', () => {
    const dayBefore = parseAutoDate('20260219');
    const result = windowOf([dayBefore], '2026-02-20');
    expect(result).toStrictEqual({ kept: [], dropped: 1 });
  });
});
