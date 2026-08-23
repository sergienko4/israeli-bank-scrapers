/**
 * Card-issuer monthly cursor policy — unit coverage for the shared calendar
 * walk behind the Amex, Isracard, Max and VisaCal transaction shapes.
 *
 * Contexts are synthetic partial casts carrying only the fields under test
 * (startDate, futureMonthsToScrape, windowEnd), so the suite is
 * self-contained, carries zero PII, and never reads the clock.
 */

import {
  billingMonthAt,
  lastOffset,
  monthAt,
  nextCursorOf,
  offsetOf,
  startMonth,
} from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/CardIssuer/CardIssuerShapeTxns.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Window start — mid-January so month arithmetic cannot straddle a boundary. */
const START = new Date(2026, 0, 15);

/** Explicit window end — mid-June, five months after the start month. */
const END = new Date(2026, 5, 20);

/** Date format used to assert on the moment-valued helpers. */
const ISO_DAY = 'YYYY-MM-DD';

/**
 * VisaCal's open-cycle floor. CAL indexes a billing month by its debit date,
 * so a purchase made today sits in next month's cycle.
 */
const OPEN_CYCLE_MONTHS = 1;

/**
 * Minimal action context carrying the window start, the future-month option,
 * and an explicit window end.
 * @param startDate - Window start.
 * @param windowEnd - Explicit upper bound (keeps the suite off the clock).
 * @param futureMonthsToScrape - Future months option; omitted for the default.
 * @returns Synthetic action context.
 */
function ctxWith(startDate: Date, windowEnd: Date, futureMonthsToScrape?: number): IActionContext {
  const bound = some(windowEnd);
  const options = { startDate, futureMonthsToScrape };
  return { options, windowEnd: bound } as unknown as IActionContext;
}

describe('CardIssuer cursor policy — calendar helpers', () => {
  it('startMonth floors the window start to the first of its month', () => {
    const ctx = ctxWith(START, END);
    const month = startMonth(ctx);
    const iso = month.format(ISO_DAY);
    expect(iso).toBe('2026-01-01');
  });

  it('monthAt advances the start month by the offset', () => {
    const ctx = ctxWith(START, END);
    const month = monthAt(ctx, 3);
    const iso = month.format(ISO_DAY);
    expect(iso).toBe('2026-04-01');
  });

  it('monthAt at offset 0 is the start month', () => {
    const ctx = ctxWith(START, END);
    const month = monthAt(ctx, 0);
    const iso = month.format(ISO_DAY);
    expect(iso).toBe('2026-01-01');
  });

  it('billingMonthAt renders the composite first-of-month form', () => {
    const ctx = ctxWith(START, END);
    const billing = billingMonthAt(ctx, 2);
    expect(billing).toBe('01/03/2026');
  });

  it('billingMonthAt at offset 0 renders the start month', () => {
    const ctx = ctxWith(START, END);
    const billing = billingMonthAt(ctx, 0);
    expect(billing).toBe('01/01/2026');
  });
});

describe('CardIssuer cursor policy — offsetOf', () => {
  it('maps the first-call sentinel to offset 0', () => {
    const offset = offsetOf(false);
    expect(offset).toBe(0);
  });

  it('passes a numeric cursor through unchanged', () => {
    const offset = offsetOf(4);
    expect(offset).toBe(4);
  });

  it('passes offset 0 through unchanged', () => {
    const offset = offsetOf(0);
    expect(offset).toBe(0);
  });
});

describe('CardIssuer cursor policy — lastOffset', () => {
  it('spans the window plus the default future month', () => {
    const ctx = ctxWith(START, END);
    const last = lastOffset(ctx);
    expect(last).toBe(6);
  });

  it('stops at the window end when no future months are requested', () => {
    const ctx = ctxWith(START, END, 0);
    const last = lastOffset(ctx);
    expect(last).toBe(5);
  });

  it('widens the window when future months are requested', () => {
    const ctx = ctxWith(START, END, 3);
    const last = lastOffset(ctx);
    expect(last).toBe(8);
  });

  it('honours a narrowed window end, as the coverage backfill supplies', () => {
    const narrowed = new Date(2026, 2, 20);
    const ctx = ctxWith(START, narrowed, 0);
    const last = lastOffset(ctx);
    expect(last).toBe(2);
  });

  it('raises a below-floor request to the issuer open-cycle floor', () => {
    const ctx = ctxWith(START, END, 0);
    const last = lastOffset(ctx, OPEN_CYCLE_MONTHS);
    expect(last).toBe(6);
  });

  it('leaves an above-floor request untouched', () => {
    const ctx = ctxWith(START, END, 3);
    const last = lastOffset(ctx, OPEN_CYCLE_MONTHS);
    expect(last).toBe(8);
  });

  it('passes a negative future-month option through when no floor is given', () => {
    const ctx = ctxWith(START, END, -2);
    const last = lastOffset(ctx);
    expect(last).toBe(3);
  });

  it('raises a negative future-month option to a supplied floor', () => {
    const ctx = ctxWith(START, END, -2);
    const last = lastOffset(ctx, OPEN_CYCLE_MONTHS);
    expect(last).toBe(6);
  });
});

describe('CardIssuer cursor policy — nextCursorOf', () => {
  it('advances while below the ceiling', () => {
    const next = nextCursorOf(2, 5);
    expect(next).toBe(3);
  });

  it('advances into the final offset', () => {
    const next = nextCursorOf(4, 5);
    expect(next).toBe(5);
  });

  it('terminates once the ceiling is reached', () => {
    const next = nextCursorOf(5, 5);
    expect(next).toBe(false);
  });

  it('terminates when already past the ceiling', () => {
    const next = nextCursorOf(6, 5);
    expect(next).toBe(false);
  });

  it('terminates immediately on a single-month window', () => {
    const next = nextCursorOf(0, 0);
    expect(next).toBe(false);
  });
});
