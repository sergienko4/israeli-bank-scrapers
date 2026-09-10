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
 * Instead each stamp is chosen so that reading it as an instant lands in a
 * *different* month from the day it names, on one side of UTC or the other.
 * Whichever side the host running these tests sits on, one of the two catches
 * an implementation that consults the instant.
 */

import type { IMonthChunk } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import {
  chunkStartMonth,
  generateMonthChunks,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';

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
  const { year, month } = chunkStartMonth(chunk);
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

describe('month chunk/the month a chunk names', () => {
  it('reads the day it names, not the instant it parses as', () => {
    const seen = [monthOf(FIRST_OF_MARCH), monthOf(LAST_OF_MARCH)];
    expect(seen).toEqual(['2026-03', '2026-03']);
  });

  it('names the month the caller actually asked for', () => {
    const start = new Date('2026-03-04T00:00:00.000Z');
    const end = new Date('2026-03-20T00:00:00.000Z');
    const chunks = generateMonthChunks(start, end);
    const named = monthOf(chunks[0]);
    expect(named).toBe('2026-03');
  });
});
