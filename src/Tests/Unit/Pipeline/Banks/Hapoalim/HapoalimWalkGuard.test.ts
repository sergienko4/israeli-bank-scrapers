/**
 * Hapoalim backwards-walk ordering guard.
 *
 * <p>The walk assumes a capped page holds the most RECENT rows of the window
 * it asked for (`sortCode=1`). These tests pin the guard that detects the
 * inverted case, which no other audit can see: `assessWindowCoverage` grades a
 * page by its OLDEST row, so a page truncated at its recent end still reaches
 * the requested start and scores `covered`.
 *
 * <p>They also pin what the guard must NOT claim. A full page is merely full,
 * not proof that rows were dropped, and the cap counts rows rather than days —
 * so two shapes that look like inversion are ordinary healthy traffic. Both
 * are covered below, because a guard that cries wolf on a normal walk is worse
 * than no guard at all.
 */

import {
  assessWalkOrder,
  type IWalkOrderArgs,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimWalkGuard.js';

/** Requested window start shared by every case here. */
const START = '20260601';

/** A day comfortably older than every `newest` used below, so pages advance. */
const ADVANCED = '20260605';

/**
 * Build guard inputs for a page reached through a cursor.
 *
 * The page is given an oldest day well below its newest, which is what a page
 * that advanced the walk looks like. Cases about stalling pass `oldest`
 * explicitly through {@link stalledAt}.
 *
 * @param asked - Day the request ended on, or false on the first page.
 * @param newest - Newest usable day the page carried.
 * @returns Guard arguments for an uncapped page that advanced.
 */
function args(asked: string | false, newest: string): IWalkOrderArgs {
  const oldest = newest === '' ? '' : ADVANCED;
  return { asked, newest, oldest, capped: false, label: 'hapoalim/txns' };
}

/**
 * Build guard inputs for a cursor page that never reached below its cursor.
 * @param asked - Day the request ended on, which is also its oldest row.
 * @param capped - Whether the page came back full at the bank's page size.
 * @returns Guard arguments for a page that did not advance the walk.
 */
function stalledAt(asked: string, capped: boolean): IWalkOrderArgs {
  return { asked, newest: asked, oldest: asked, capped, label: 'hapoalim/txns' };
}

/**
 * Build guard inputs for a first page, which carries no cursor.
 * @param oldest - Oldest usable day the page carried.
 * @param newest - Newest usable day the page carried.
 * @param capped - Whether the page came back full at the bank's page size.
 * @returns Guard arguments with no cursor.
 */
function firstPage(oldest: string, newest: string, capped: boolean): IWalkOrderArgs {
  return { asked: false, newest, oldest, capped, label: 'hapoalim/txns' };
}

describe('Hapoalim walk-order guard — ordering honoured', () => {
  it('newest row equal to the asked day is honoured', () => {
    const page = args('20260715', '20260715');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('honoured');
  });
});

/**
 * A cursor page that never reached below the day it asked from.
 *
 * <p>This means something only when the page is also full. Uncapped, it is how
 * every normal walk ends — the window held nothing older — and warning on it
 * would fire on healthy traffic. Full, one day is carrying a whole page and
 * the cursor cannot move, which is a completeness risk rather than proof that
 * the ordering inverted.
 */
describe('Hapoalim walk-order guard — cursor did not advance', () => {
  it('a full page holding only its cursor day is stalled', () => {
    const page = stalledAt('20260715', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('stalled');
  });

  it('says the cursor cannot advance', () => {
    const page = stalledAt('20260715', true);
    const out = assessWalkOrder(page);
    expect(out.detail).toContain('cursor cannot advance');
  });

  it('does not call a stalled cursor an ordering violation', () => {
    // A full day is a date-cursor granularity limit, not evidence that the
    // bank returned the oldest slice. Grading it `violated` would put an
    // unprovable claim in the log.
    const page = stalledAt('20260715', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).not.toBe('violated');
  });

  it('an uncapped page holding only its cursor day is the ordinary walk end', () => {
    // The previous page was full and ended on this day; re-asking inclusively
    // returned that day alone and nothing older, so the window is exhausted
    // and the caller stops. Nothing is wrong and nothing may be logged.
    const page = stalledAt('20260225', false);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('honoured');
  });

  it('reports no detail for that ordinary walk end', () => {
    const page = stalledAt('20260225', false);
    const out = assessWalkOrder(page);
    expect(out.detail).toBe('');
  });

  it('a page that did reach below its cursor is honoured', () => {
    const page = args('20260715', '20260715');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('honoured');
  });
});

/**
 * Day pairs whose newest row falls below the day the request asked for.
 *
 * Each row is the same fault reached by a different distance — a fortnight, a
 * single day, and across a year boundary, the last of which a string-length
 * comparison would miss.
 */
const VIOLATED_CASES = [
  { why: 'a newest row a fortnight older than asked', asked: '20260715', newest: '20260701' },
  { why: 'a newest row a single day older than asked', asked: '20260715', newest: '20260714' },
  { why: 'a newest row older across a year boundary', asked: '20260101', newest: '20251231' },
] as const;

describe('Hapoalim walk-order guard — ordering violated', () => {
  it.each(VIOLATED_CASES)('$why is violated', ({ asked, newest }) => {
    const page = args(asked, newest);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
  });

  it('violation reports both days it compared', () => {
    const page = args('20260715', '20260701');
    const out = assessWalkOrder(page);
    expect(out.asked).toBe('20260715');
    expect(out.newest).toBe('20260701');
  });
});

/**
 * A page whose newest row post-dates the bound its request carried.
 *
 * The bound is inclusive of the cursor day, so a newer row means the bank
 * served outside the window it was given. That is a different fault from
 * truncation and must not be graded as honouring the ordering, which is what
 * a `>=` comparison did.
 */
describe('Hapoalim walk-order guard — bound ignored', () => {
  it('newest row later than the asked day is not honoured', () => {
    const page = args('20260715', '20260716');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('beyond');
  });

  it('reports the days behind the fault', () => {
    const page = args('20260715', '20260716');
    const out = assessWalkOrder(page);
    expect(out.detail).toContain('asked=20260715');
    expect(out.detail).toContain('newest=20260716');
  });
});

/**
 * The first page, which carries no cursor and so no ordering evidence.
 *
 * <p>A capped page that reaches the requested start looks like the inversion
 * signature and is not. `pageWasCapped` means the page came back *full*, not
 * that rows were dropped, and the cap counts rows rather than days — so the
 * boundary can fall part-way through the start day. `HapoalimTxnPaging` pins
 * that exact shape as healthy and the walk recovers the withheld rows by
 * re-asking the start day inclusively. Every case here must therefore report
 * `unknown`.
 */
describe('Hapoalim walk-order guard — first page', () => {
  it('a full page reaching the requested start proves nothing', () => {
    // 149 newer rows plus one of the two rows on the start day fills a
    // 150-row page under correct newest-first ordering.
    const page = firstPage(START, '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('never warns about a full page reaching the requested start', () => {
    const page = firstPage(START, '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.detail).toBe('');
  });

  it('a full page reaching past the requested start proves nothing', () => {
    const page = firstPage('20260501', '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('a full page stopping short of the start proves nothing', () => {
    const page = firstPage('20260620', '20260715', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('an uncapped page reaching the start is the ordinary complete case', () => {
    const page = firstPage(START, '20260715', false);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });
});

describe('Hapoalim walk-order guard — no evidence either way', () => {
  it('a page with no usable date proves nothing', () => {
    const page = args('20260715', '');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('a first page with no usable date proves nothing even when capped', () => {
    const page = firstPage('', '', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('an unknown verdict reports no days', () => {
    const page = args(false, '');
    const out = assessWalkOrder(page);
    expect(out.asked).toBe('');
    expect(out.newest).toBe('');
  });
});
