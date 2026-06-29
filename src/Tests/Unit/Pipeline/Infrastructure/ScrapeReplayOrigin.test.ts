/**
 * Unit tests for the BaNCS request-envelope origin injection in
 * buildMonthBody. The scrape replay must restore the `UIID.Id` origin
 * the bank's input validator requires on data-bearing windows —
 * without it the bank returns 88501 (`Path:"origin"`) and the month's
 * transactions are dropped (run 29-06-2026_19271361 scrape-ACTION/0039).
 */

import { buildMonthBody } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';
import ORIGIN from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeRequestEnvelope.js';

/** Origin object after a buildMonthBody round-trip. */
interface IOriginEnvelope {
  readonly Ver: string;
  readonly Id?: string;
}

/**
 * Build a BaNCS filtered-INQ template with an EMPTY origin — the exact
 * shape that produced 88501 on the data-bearing June window.
 * @returns Serialized POST template string.
 */
function emptyOriginTemplate(): string {
  return JSON.stringify({
    Ver: 'MessagePayload_1.0.0',
    UIID: { Ver: 'UIIDomain_1.0.0' },
    Payload: { Operation: 'INQ', Category: ['CURRENT_ACCOUNT'] },
  });
}

describe('buildMonthBody — BaNCS request origin', () => {
  it('populates the empty UIID.Id origin the validator requires', () => {
    const result = buildMonthBody({
      template: emptyOriginTemplate(),
      accountId: 'A1',
      month: 6,
      year: 2026,
    });
    const uiid = result.UIID as unknown as IOriginEnvelope;
    expect(uiid.Id).toBe(ORIGIN.value);
  });

  it('preserves an already-populated origin', () => {
    const template = JSON.stringify({
      UIID: { Ver: 'UIIDomain_1.0.0', Id: 'Existing' },
      Payload: {},
    });
    const result = buildMonthBody({ template, accountId: 'A1', month: 6, year: 2026 });
    expect((result.UIID as unknown as IOriginEnvelope).Id).toBe('Existing');
  });

  it('leaves non-BaNCS bodies (no UIIDomain envelope) untouched', () => {
    const template = JSON.stringify({ accountId: 'X', month: '1', year: '2025' });
    const result = buildMonthBody({ template, accountId: 'A1', month: 6, year: 2026 });
    expect('UIID' in result).toBe(false);
  });
});
