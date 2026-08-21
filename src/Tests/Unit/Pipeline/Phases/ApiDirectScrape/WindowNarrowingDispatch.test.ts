/**
 * Cross-bank contract: the declared stance must reach the backfill decision.
 *
 * The sibling contract proves each `windowNarrowing` declaration is *true* —
 * that moving the bound really does change the bytes on the wire. This one
 * proves the declaration is *used*: that for all sixteen banks the runtime
 * decision follows from it, and that no bank falls through the dispatch into
 * silence.
 *
 * Both halves are needed. A true declaration nothing reads would still leave a
 * bank unbackfilled; a read declaration that lied would loop without ever
 * changing the request. Neither failure raises an error on its own.
 */

import { assessWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { planBackfill } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { BACKFILL_EXCLUSION } from '../../../../../Scrapers/Pipeline/Types/WindowNarrowing.js';
import { WINDOW_NARROWING_CASES } from './WindowNarrowingFixtures.js';

/** Start of the window every case in this file asks for. */
const REQUESTED_START = '2026-01-01T00:00:00.000Z';

/** Oldest row every case holds — three months short of the start. */
const OLDEST_HELD = '2026-04-10';

/** Bound the assessed request carried, well after the oldest row held. */
const PREVIOUS_END: Option<Date> = some(new Date('2026-07-01T00:00:00Z'));

/** Row shape the coverage audit can date. */
const SHORT_ROWS: readonly object[] = [{ date: `${OLDEST_HELD}T00:00:00Z` }];

/** Coverage every case is judged against: rows that fall short of the start. */
const SHORTFALL = assessWindowCoverage({
  requestedStart: REQUESTED_START,
  rows: SHORT_ROWS,
  label: 'contract/txns',
});

const CASE_ROWS = WINDOW_NARROWING_CASES.map(c => [c.bank, c] as const);

/**
 * A date's calendar day in the local zone.
 *
 * The bound is a local midnight and every shape formats it locally, so
 * rendering it as UTC would report the preceding day for half the year.
 * @param when - Date to render.
 * @returns Calendar day, `YYYY-MM-DD`.
 */
function dayOf(when: Date): string {
  const year = when.getFullYear();
  const month = when.getMonth() + 1;
  const day = when.getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year)}-${mm}-${dd}`;
}

describe('the shortfall these cases are judged against', () => {
  it('is a real gap, so every case reaches the stance dispatch', () => {
    expect(SHORTFALL.verdict).toBe('unproven');
  });

  it('carries the oldest row held, so a narrowed bound is derivable', () => {
    expect(SHORTFALL.oldest).toBe(OLDEST_HELD);
  });
});

describe('stance dispatch across every bank', () => {
  it.each(CASE_ROWS)('[%s] reaches a decision that names its stance', (_bank, testCase) => {
    const stance = testCase.txns.windowNarrowing;
    const plan = planBackfill({
      stance,
      coverage: SHORTFALL,
      attempt: 0,
      previousEnd: PREVIOUS_END,
      label: 'contract/txns',
    });
    const canNarrow = stance === 'windowEnd';
    expect(plan.shouldAsk).toBe(canNarrow);
  });

  it.each(CASE_ROWS)('[%s] explains the decision either way', (_bank, testCase) => {
    const plan = planBackfill({
      stance: testCase.txns.windowNarrowing,
      coverage: SHORTFALL,
      attempt: 0,
      previousEnd: PREVIOUS_END,
      label: 'contract/txns',
    });
    expect(plan.reason.length).toBeGreaterThan(0);
  });
});

describe('banks that can narrow', () => {
  const narrowable = CASE_ROWS.filter(([, c]) => c.txns.windowNarrowing === 'windowEnd');

  it.each(narrowable)('[%s] is asked again from the oldest row held', (_bank, testCase) => {
    const plan = planBackfill({
      stance: testCase.txns.windowNarrowing,
      coverage: SHORTFALL,
      attempt: 0,
      previousEnd: PREVIOUS_END,
      label: 'contract/txns',
    });
    const bound = plan.nextEnd.has ? dayOf(plan.nextEnd.value) : '';
    expect(bound).toBe('2026-04-10');
  });
});

describe('banks that cannot narrow', () => {
  const fixed = CASE_ROWS.filter(([, c]) => c.txns.windowNarrowing !== 'windowEnd');

  it.each(fixed)('[%s] is refused for its own declared reason', (_bank, testCase) => {
    const stance = testCase.txns.windowNarrowing;
    const plan = planBackfill({
      stance,
      coverage: SHORTFALL,
      attempt: 0,
      previousEnd: PREVIOUS_END,
      label: 'contract/txns',
    });
    const expected = stance === 'windowEnd' ? '' : BACKFILL_EXCLUSION[stance];
    expect(plan.reason).toContain(expected);
  });

  it.each(fixed)('[%s] is never handed a bound it could not use', (_bank, testCase) => {
    const plan = planBackfill({
      stance: testCase.txns.windowNarrowing,
      coverage: SHORTFALL,
      attempt: 0,
      previousEnd: PREVIOUS_END,
      label: 'contract/txns',
    });
    const absent: Option<Date> = none();
    expect(plan.nextEnd).toEqual(absent);
  });
});
