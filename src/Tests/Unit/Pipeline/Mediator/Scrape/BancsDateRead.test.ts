/**
 * readBancsFromDate — reads the captured lower (`GREATERTHAN*`) `OrigDt`
 * bound from a BaNCS CURRENT_ACCOUNT request body.
 *
 * Regression guard (Yahav txn-completeness, 2026-07-05): the SCRAPE firstWave
 * gate (`capturedWindowCoversRequested`) reused Yahav's DASHBOARD default-load
 * PREVIEW (2 same-day txns) instead of re-fetching the requested 180-day range,
 * because it only inspected the URL for a date window. Yahav (BaNCS) carries
 * its window in the POST BODY (`OrigDt`), so the gate now reads the body
 * fromDate to tell a narrow preview from a window that already covers the
 * request. This pins that reader — narrow, wide, and default-deny.
 */

import { readBancsFromDate } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsDateTemplate.js';
import { balanceBody, txnBody } from '../../../../BancsRequestFixtures.js';

/** A calendar date in BaNCS numeric parts (Month is 1-based). */
interface IFromParts {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/**
 * Build a BaNCS CURRENT_ACCOUNT body with a specific `GREATERTHAN*` from-bound.
 * @param from - Day / 1-based month / year of the lower bound.
 * @returns A synthetic BaNCS transactions request body.
 */
function bancsBodyFrom(from: IFromParts): Record<string, unknown> {
  const lower = {
    Operator: 'GREATERTHANOREQUAL',
    OrigDt: { Day: from.day, Month: from.month, Year: from.year },
  };
  const upper = { Operator: 'LESSTHANOREQUAL', OrigDt: { Day: 31, Month: 12, Year: from.year } };
  return { Payload: { Category: ['CURRENT_ACCOUNT'], Filters: [{ Filters: [lower, upper] }] } };
}

describe('readBancsFromDate', () => {
  it('reads the GREATERTHAN* OrigDt fromDate of a CURRENT_ACCOUNT body', () => {
    const body = txnBody();
    const result = readBancsFromDate(body);
    const isDate = result !== false;
    expect(isDate).toBe(true);
    const ms = result === false ? 0 : result.getTime();
    const expected = Date.UTC(2026, 0, 1); // fixture lower bound = Day 1 / Month 1 / Year 2026
    expect(ms).toBe(expected);
  });

  it('reads a specific narrow from-bound (Month is 1-based)', () => {
    const body = bancsBodyFrom({ day: 5, month: 7, year: 2026 });
    const result = readBancsFromDate(body);
    const ms = result === false ? 0 : result.getTime();
    const expected = Date.UTC(2026, 6, 5); // July -> index 6
    expect(ms).toBe(expected);
  });

  it('returns false for a non-txn BaNCS body (portfolioBalance, no date range)', () => {
    const body = balanceBody();
    const result = readBancsFromDate(body);
    expect(result).toBe(false);
  });

  it('returns false for a non-BaNCS body (default-deny)', () => {
    const result = readBancsFromDate({});
    expect(result).toBe(false);
  });
});
