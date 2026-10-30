/**
 * UT-CAL-01 — the VisaCal per-card balance read from CAL's frames response.
 *
 * Attribution is by card id only: a frame naming another card never lends
 * its figure, and a card with no frame (or a non-numeric figure) reports 0,
 * the true "nothing pending" answer. Bodies are synthetic, with no PII.
 */

import {
  balanceUrl,
  balanceVars,
  nextTotalDebitOf,
} from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeBalance.js';
import type { IVisaCalCard } from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeHelpers.js';
import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';

const CARD: IVisaCalCard = { cardUniqueId: 'CARD-1', displayNumber: '1234' };

/**
 * Wrap account-level frames in the frames response envelope.
 * @param frames - Synthetic `accountLevelFrames` entries.
 * @returns Frames response body.
 */
function framesBody(frames: readonly object[]): ApiBody {
  return { statusCode: 1, result: { calIssuedCards: { accountLevelFrames: frames } } };
}

describe('VisaCal frames balance (UT-CAL-01)', () => {
  it('asks for one card per request', () => {
    const vars = balanceVars(CARD);
    expect(vars).toEqual({ cardsForFrameData: [{ cardUniqueId: 'CARD-1' }] });
  });

  it('posts to the frames endpoint on the web gateway', () => {
    const url = balanceUrl();
    expect(url).toBe('https://api.cal-online.co.il/Frames/api/Frames/GetTotalFrameStatus');
  });

  it("reads the card's own next debit, never another card's", () => {
    const body = framesBody([
      { cardUniqueId: 'CARD-9', nextTotalDebit: 999.5 },
      { cardUniqueId: 'CARD-1', nextTotalDebit: 412.37 },
    ]);
    const balance = nextTotalDebitOf(body, CARD);
    expect(balance).toBe(412.37);
  });

  it.each([
    ['no frame names the card', framesBody([{ cardUniqueId: 'CARD-9', nextTotalDebit: 50 }])],
    ['the frame list is empty', framesBody([])],
    ['the result is null', { statusCode: 1, result: null }],
    ['the figure is a string', framesBody([{ cardUniqueId: 'CARD-1', nextTotalDebit: '412' }])],
    ['the figure is not finite', framesBody([{ cardUniqueId: 'CARD-1', nextTotalDebit: NaN }])],
  ])('reports 0 when %s', (_case, body) => {
    const balance = nextTotalDebitOf(body, CARD);
    expect(balance).toBe(0);
  });
});
