/**
 * Hapoalim backwards-walk ordering guard.
 *
 * <p>The walk assumes a capped page holds the most RECENT rows of the window
 * it asked for (`sortCode=1`). These tests pin the guard that detects the
 * inverted case, which no other audit can see: `assessWindowCoverage` grades a
 * page by its OLDEST row, so a page truncated at its recent end still reaches
 * the requested start and scores `covered`.
 *
 * <p>The first-page cases matter most. Under inversion the walk stops on page
 * one — its oldest row already reaches the requested start, so no cursor is
 * ever minted — which means a guard that only reads cursors can never fire on
 * the very fault it exists for.
 */

import {
  assessWalkOrder,
  type IWalkOrderArgs,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimWalkGuard.js';

/** Requested window start shared by every case here. */
const START = '20260601';

/**
 * Build guard inputs for a page reached through a cursor.
 * @param asked - Day the request ended on, or false on the first page.
 * @param newest - Newest usable day the page carried.
 * @returns Guard arguments for an uncapped page.
 */
function args(asked: string | false, newest: string): IWalkOrderArgs {
  const oldest = newest === '' ? '' : newest;
  return { asked, newest, oldest, capped: false, requestedStart: START, label: 'hapoalim/txns' };
}

/**
 * Build guard inputs for a first page, which carries no cursor.
 * @param oldest - Oldest usable day the page carried.
 * @param newest - Newest usable day the page carried.
 * @param capped - Whether the bank truncated the page at its own limit.
 * @returns Guard arguments with no cursor.
 */
function firstPage(oldest: string, newest: string, capped: boolean): IWalkOrderArgs {
  return { asked: false, newest, oldest, capped, requestedStart: START, label: 'hapoalim/txns' };
}

describe('Hapoalim walk-order guard — ordering honoured', () => {
  it('newest row equal to the asked day is honoured', () => {
    const page = args('20260715', '20260715');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('honoured');
  });
});

describe('Hapoalim walk-order guard — ordering violated', () => {
  it('newest row older than the asked day is violated', () => {
    const page = args('20260715', '20260701');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
  });

  it('violation reports both days it compared', () => {
    const page = args('20260715', '20260701');
    const out = assessWalkOrder(page);
    expect(out.asked).toBe('20260715');
    expect(out.newest).toBe('20260701');
  });

  it('a single day older than asked is still violated', () => {
    const page = args('20260715', '20260714');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
  });

  it('compares calendar days, not string length, across a year boundary', () => {
    const page = args('20260101', '20251231');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
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
 * The first page — the only page the inverted-ordering fault ever reaches.
 *
 * A cap asserts more rows existed than were returned; under the assumed
 * ordering the cap drops the oldest of them, so a capped page cannot also
 * reach back to the requested start.
 */
describe('Hapoalim walk-order guard — first page', () => {
  it('a capped page reaching the requested start is violated', () => {
    const page = firstPage(START, '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
  });

  it('a capped page reaching past the requested start is violated', () => {
    const page = firstPage('20260501', '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('violated');
  });

  it('names the days behind the first-page verdict', () => {
    const page = firstPage(START, '20260610', true);
    const out = assessWalkOrder(page);
    expect(out.detail).toContain(`oldest=${START}`);
    expect(out.detail).toContain(`start=${START}`);
  });

  it('a capped page stopping short of the start proves nothing', () => {
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
