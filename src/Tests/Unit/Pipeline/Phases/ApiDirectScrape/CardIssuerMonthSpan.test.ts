/**
 * Card-issuer month enumeration: the walk must cover the caller's window at
 * both ends.
 *
 * <p>An issuer indexes transactions by billing month, so its walk is a count
 * of months rather than a pair of dates. That count is a subtraction between
 * two month starts — and a subtraction is only meaningful when both operands
 * are read in the same calendar. Read one in the bank's zone and the other in
 * the host's, and a window that starts on the 1st loses a whole billing cycle
 * on hosts west of Israel: not a few rows, an entire month, with nothing in
 * the result to say so.
 *
 * <p>These tests pin the count itself, so the property survives a future
 * refactor that reintroduces a mixed-zone subtraction without changing any of
 * the request-shape fixtures.
 */

import { jest } from '@jest/globals';

import {
  lastOffset,
  startMonth,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/CardIssuer/CardIssuerShapeTxns.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { underZone } from '../../../../Helpers/AmbientZone.js';
import { ctxSpanning } from './WindowNarrowingFixtures.js';

/** Hosts to impersonate — one either side of Israel, plus UTC. */
const ZONES = ['Asia/Jerusalem', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'] as const;

/**
 * A window end a couple of hours past a month boundary in UTC.
 *
 * <p>This is the only shape that exposes a mixed-zone subtraction: west of
 * Israel this instant still falls in the *previous* month, so an unanchored
 * `windowEnd` starts its count a whole cycle earlier than a bank-anchored
 * start month. A mid-month end cannot show it — both operands land in the
 * same month whatever the host — which is why one exists here and the cases
 * above use a different end.
 */
const BOUNDARY_END = new Date('2026-06-01T02:00:00.000Z');

/** Instant every case observes, so no offset can vary by clock. */
const FROZEN_NOW = Date.parse('2026-06-15T09:00:00.000Z');

/** Window end used throughout — mid-June, comfortably inside the frozen day. */
const WINDOW_END = new Date('2026-06-15T09:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({ now: FROZEN_NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Build a context spanning `start` to a fixed mid-June end.
 * @param start - Lower bound of the scrape window.
 * @returns Action context for the issuer helpers.
 */
function ctxFrom(start: string): IActionContext {
  const from = new Date(start);
  return ctxSpanning(from, WINDOW_END);
}

describe('cardIssuer/month span', () => {
  /**
   * A start on the 1st is the boundary case: any zone skew at all moves it
   * into the previous or next month, changing the offset by one whole cycle.
   *
   * <p>Each expectation is the number of months from the start to mid-June
   * inclusive, plus the one future cycle the default `futureMonthsToScrape`
   * asks for. February → June is five month-steps, so the offset is 5.
   */
  it.each([
    ['2026-02-01T00:00:00Z', 5],
    ['2026-06-01T00:00:00Z', 1],
    ['2025-12-01T00:00:00Z', 7],
  ])('counts every month from %s inclusive', (start, expected) => {
    const ctx = ctxFrom(start);
    const offset = lastOffset(ctx);
    expect(offset).toBe(expected);
  });

  it('names the caller\u2019s own month as offset zero', () => {
    const ctx = ctxFrom('2026-02-09T22:30:00Z');
    const month = startMonth(ctx);
    const label = month.format('YYYY-MM');
    expect(label).toBe('2026-02');
  });

  /**
   * An open-cycle floor must extend the walk past the window end, never
   * replace the count — VisaCal depends on this to reach next month's cycle.
   */
  it('counts the same months on every host across a month boundary', () => {
    jest.setSystemTime(BOUNDARY_END);
    const seen = ZONES.map((zone): number => {
      const ctx = ctxSpanning(new Date('2026-02-01T00:00:00Z'), BOUNDARY_END);
      return underZone(zone, (): number => lastOffset(ctx));
    });
    const expected = ZONES.map((): number => seen[0]);
    expect(seen).toEqual(expected);
  });

  it('extends past the window end by an issuer floor', () => {
    const ctx = ctxFrom('2026-06-01T00:00:00Z');
    const offset = lastOffset(ctx, 3);
    expect(offset).toBe(3);
  });
});
