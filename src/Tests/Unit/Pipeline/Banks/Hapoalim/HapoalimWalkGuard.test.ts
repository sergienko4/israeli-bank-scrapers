/**
 * Hapoalim backwards-walk ordering guard.
 *
 * <p>The walk assumes a capped page holds the most RECENT rows of the window
 * it asked for (`sortCode=1`). These tests pin the guard that detects the
 * inverted case, which no other audit can see: `assessWindowCoverage` grades a
 * page by its OLDEST row, so a page truncated at its recent end still reaches
 * the requested start and scores `covered`.
 */

import {
  assessWalkOrder,
  type IWalkOrderArgs,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimWalkGuard.js';

/**
 * Build guard inputs with a fixed label.
 * @param asked - Day the request ended on, or false on the first page.
 * @param newest - Newest usable day the page carried.
 * @returns Guard arguments.
 */
function args(asked: string | false, newest: string): IWalkOrderArgs {
  return { asked, newest, label: 'hapoalim/txns' };
}

describe('Hapoalim walk-order guard — ordering honoured', () => {
  it('newest row equal to the asked day is honoured', () => {
    const page = args('20260715', '20260715');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('honoured');
  });

  it('newest row later than the asked day is honoured', () => {
    const page = args('20260715', '20260716');
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

describe('Hapoalim walk-order guard — no evidence either way', () => {
  it('the first page of a walk proves nothing', () => {
    const page = args(false, '20260715');
    const out = assessWalkOrder(page);
    expect(out.verdict).toBe('unknown');
  });

  it('a page with no usable date proves nothing', () => {
    const page = args('20260715', '');
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
