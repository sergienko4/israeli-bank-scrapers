/**
 * A month chunk names a bank-calendar day and stamps it with a literal `Z`.
 * That suffix is a formatting convention, not a claim about UTC, so reading
 * the whole string back as an instant and asking a host-local `Date` which
 * month it is can answer with the neighbouring month.
 *
 * <p>Two consumers built a month/year request parameter that way, so a scrape
 * for March asked the bank for February on any host west of UTC — silently,
 * and with no way for the caller to tell.
 *
 * <p>These probes do not move the ambient zone. `jest.config.js` says plainly
 * that "reassigning `TZ` from inside a test does not work" — workers honour it
 * at startup — so a runtime zone swap would prove nothing about native `Date`.
 *
 * <p>Nor is it enough to pick inputs whose instant month differs from their
 * label month: CI runs this suite under `jest.pipeline.config.cjs`, which pins
 * no zone, so it executes in the runner's UTC. In UTC the two readings agree
 * *by construction* — the label is the UTC date part of the stamp — so no
 * choice of input can tell them apart there, and a zone-sensitive probe is
 * vacuous on exactly the machine that has to catch the regression.
 *
 * <p>So the invariant is asserted directly instead: the reader must not consult
 * the ambient clock at all. {@link withoutDate} swaps `Date` for a stand-in
 * that reports 1999, which fails an instant-reading implementation in every
 * zone, UTC included.
 */

import type { IMonthChunk } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import {
  chunkStartMonth,
  generateMonthChunks,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import requireMonthChunks from '../../../../Helpers/MonthChunkPlan.js';

/**
 * Midnight on the first — an instant reader on a host *west* of UTC rolls back
 * into February.
 */
const FIRST_OF_MARCH: IMonthChunk = {
  start: '2026-03-01T00:00:00.000Z',
  end: '2026-03-31T23:59:59.000Z',
};

/**
 * The last second of March — an instant reader on a host *east* of UTC, the
 * bank's own side, rolls forward into April.
 */
const LAST_OF_MARCH: IMonthChunk = {
  start: '2026-03-31T23:59:59.000Z',
  end: '2026-03-31T23:59:59.000Z',
};

/**
 * Render what a chunk names, as a bank request parameter would carry it.
 * @param chunk - The chunk to read.
 * @returns Its month as `YYYY-MM`.
 */
function monthOf(chunk: IMonthChunk): string {
  const named = chunkStartMonth(chunk);
  if (named === false) return 'invalid';
  const { year, month } = named;
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

/**
 * What a tampered clock reports: a moment far from anything this suite uses, so
 * an implementation that reads the instant produces an obviously wrong month
 * rather than an accidentally right one.
 */
const CLOCK_SENTINEL = {
  /**
   * Report a year no chunk in this suite names.
   * @returns 1999.
   */
  getFullYear: (): number => 1999,
  /**
   * Report a month no chunk in this suite names.
   * @returns January, zero-indexed as the real `Date` reports it.
   */
  getMonth: (): number => 0,
};

/**
 * Stand-in for `Date`. A constructor that returns an object yields that object,
 * so `new Date(anything)` becomes the sentinel.
 * @returns The sentinel clock.
 */
function tamperedClock(): object {
  return CLOCK_SENTINEL;
}

/**
 * Take the ambient clock away for the duration of one call, so that reading a
 * chunk through `new Date(...)` reports 1999 instead of quietly answering in
 * the host's zone. Unlike a zone swap this discriminates in every zone, UTC
 * included — which is the zone CI actually runs in.
 * @param run - Probe to evaluate against the tampered clock.
 * @returns Whatever the probe returned.
 */
function withoutDate<T>(run: () => T): T {
  const realDate = globalThis.Date;
  globalThis.Date = tamperedClock as unknown as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = realDate;
  }
}

describe('month chunk/the month a chunk names', () => {
  it('never consults the ambient clock', () => {
    const named = withoutDate((): string => monthOf(FIRST_OF_MARCH));
    expect(named).toBe('2026-03');
  });

  it('reads the day it names, not the instant it parses as', () => {
    const seen = [monthOf(FIRST_OF_MARCH), monthOf(LAST_OF_MARCH)];
    expect(seen).toEqual(['2026-03', '2026-03']);
  });

  it('rejects a malformed generated label instead of returning NaN or a shifted date', () => {
    const malformed: IMonthChunk = {
      start: '2026-02-31T00:00:00.000Z',
      end: '2026-02-31T23:59:59.000Z',
    };
    const named = chunkStartMonth(malformed);
    expect(named).toBe(false);
  });

  it('names the month the caller actually asked for', () => {
    const start = new Date('2026-03-04T00:00:00.000Z');
    const end = new Date('2026-03-20T00:00:00.000Z');
    const generated = generateMonthChunks(start, end);
    const chunks = requireMonthChunks(generated);
    const named = monthOf(chunks[0]);
    expect(named).toBe('2026-03');
  });
});
