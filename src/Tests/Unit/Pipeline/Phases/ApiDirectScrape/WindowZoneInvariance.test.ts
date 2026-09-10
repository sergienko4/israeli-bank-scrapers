/**
 * Cross-bank contract: the same scrape window must produce the same request on
 * every host.
 *
 * <p>Every bank turns the window's two ends into wire values, and each end is
 * an *instant* that has to be named as a *day* (or a billing month) in the
 * bank's calendar. Read in the host's zone instead, the same window becomes a
 * different request per machine — and the two directions fail differently:
 *
 * <ul>
 *   <li><b>West of Israel</b> the bound lands after the rows already held, the
 *   provider re-serves the same set, the oldest row never moves and the
 *   backfill refuses with `boundDidNotMove` on its first retry.</li>
 *   <li><b>East of Israel</b> the start names the *next* day, so the caller's
 *   first day is never requested at all — a gap at the far end of the window
 *   that no amount of backfill can close, because backfill only moves the
 *   upper bound.</li>
 * </ul>
 *
 * <p>Either way the caller is told the window is unproven, on some hosts only.
 * Rather than list the renderers — the list went stale twice — this asserts the
 * property they all have to satisfy, for every bank the phase serves.
 */

import { jest } from '@jest/globals';

import { underZone } from '../../../../Helpers/AmbientZone.js';
import type { IWindowNarrowingCase } from './WindowNarrowingFixtures.js';
import {
  ctxSpanning,
  EARLY_END,
  renderWalk,
  WINDOW_NARROWING_CASES,
} from './WindowNarrowingFixtures.js';

/**
 * Israel, UTC, and one zone either side. Only a zone east of Israel catches a
 * bank-anchored instant being read back ambiently; only one west of it catches
 * the reverse.
 */
const ZONES = ['Asia/Jerusalem', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'] as const;

/** Instant every render observes, so no request can vary by clock. */
const FROZEN_NOW = Date.parse('2026-06-01T12:00:00.000Z');

/**
 * A window whose start sits on a month boundary.
 *
 * <p>Deliberate: a card issuer enumerates billing *months*, so only a start
 * within a day of a boundary can shift its first cycle. A mid-month start
 * cleared every issuer regardless of the truth.
 */
const BOUNDARY_START = new Date('2026-02-01T00:00:00Z');

/** A window whose start sits far from any boundary, exercising day renderers. */
const MIDMONTH_START = new Date('2026-02-09T00:00:00Z');

beforeEach(() => {
  jest.useFakeTimers({ now: FROZEN_NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Render one bank's walk once per ambient zone.
 * @param txns - The bank's transactions step.
 * @param start - Lower bound of the window.
 * @returns One rendering per entry in {@link ZONES}.
 */
function walkPerZone(txns: IWindowNarrowingCase['txns'], start: Date): string[] {
  return ZONES.map((zone): string => {
    const ctx = ctxSpanning(start, EARLY_END);
    return underZone(zone, (): string => renderWalk(txns, ctx));
  });
}

const CASE_ROWS = WINDOW_NARROWING_CASES.map(c => [c.bank, c] as const);

describe('window/zone-invariance contract', () => {
  it.each(CASE_ROWS)('%s asks the same thing from any host (mid-month start)', (_bank, c) => {
    const seen = walkPerZone(c.txns, MIDMONTH_START);
    const expected = ZONES.map((): string => seen[0]);
    expect(seen).toEqual(expected);
  });

  it.each(CASE_ROWS)('%s asks the same thing from any host (month-boundary start)', (_bank, c) => {
    const seen = walkPerZone(c.txns, BOUNDARY_START);
    const expected = ZONES.map((): string => seen[0]);
    expect(seen).toEqual(expected);
  });
});
