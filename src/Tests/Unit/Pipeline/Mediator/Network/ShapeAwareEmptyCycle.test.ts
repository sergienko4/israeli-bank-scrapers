/**
 * discoverShapeAware — Max empty current-cycle rescue (windowParamsMatch).
 *
 * Drives the REAL production picker (not a re-implementation). Regression guard
 * (live real-E2E, 2026-07-05): Max's txn endpoint
 * `…/transactionDetails/getTransactionsAndGraphs` fired 200 but the current
 * billing cycle was empty (`{"result":null,"returnCode":10}` — non-null body, no
 * txn array). The shape/replayable tiers need a txn array, and the empty body is
 * indistinguishable from a summary — so the ONLY safe discriminator is Max's
 * COMPLETE date window (`filterData={…"dates":{"startDate","endDate"}…}`). The
 * `windowParamsMatch` tier (now JSON-param aware) commits it so SCRAPE
 * (`scrapeViaFilterData`) re-fetches the historical range per month. A one-sided
 * window (summary URL with only `startDate`) stays rejected.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import discoverShapeAware from '../../../../../Scrapers/Pipeline/Mediator/Network/Scoring/ShapeAware.js';
import { PIPELINE_WELL_KNOWN_API } from '../../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';

const TXN_PATTERNS = PIPELINE_WELL_KNOWN_API.transactions;
const MAX_BASE = 'https://www.max.co.il/api/registered/transactionDetails/getTransactionsAndGraphs';
const MAX_WINDOWED_URL = `${MAX_BASE}?filterData=${encodeURIComponent(
  '{"monthView":true,"dates":{"startDate":"0","endDate":"0"}}',
)}&v=V4`;
const MAX_ONESIDED_URL = `${MAX_BASE}?filterData=${encodeURIComponent(
  '{"dates":{"startDate":"0"}}',
)}&v=V4`;
/** Max's real empty-current-cycle body: result is null, no txn container. */
const MAX_EMPTY_BODY = { result: null, returnCode: 10 } as const;

/**
 * Build a minimal captured endpoint for the picker.
 * @param url - Captured URL.
 * @param body - Parsed response body (non-null empty envelope, or with txns).
 * @returns Endpoint stub.
 */
function makeCapture(url: string, body: unknown): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody: body,
    timestamp: Date.now(),
  };
}

describe('discoverShapeAware — Max empty current-cycle rescue', () => {
  it('commits Max getTransactionsAndGraphs when filterData carries a startDate+endDate window', () => {
    const cap = makeCapture(MAX_WINDOWED_URL, MAX_EMPTY_BODY);
    const picked = discoverShapeAware([cap], [cap], TXN_PATTERNS);
    const isPicked = picked !== false;
    expect(isPicked).toBe(true);
    const tier = picked === false ? 'none' : picked.pickerTier;
    expect(tier).toBe('windowParamsMatch');
  });

  it('does NOT commit a one-sided window (startDate only) — summary-safe', () => {
    const cap = makeCapture(MAX_ONESIDED_URL, MAX_EMPTY_BODY);
    const picked = discoverShapeAware([cap], [cap], TXN_PATTERNS);
    expect(picked).toBe(false);
  });

  it('still prefers a shape-passing capture over an empty windowed one (precedence)', () => {
    const empty = makeCapture(MAX_WINDOWED_URL, MAX_EMPTY_BODY);
    const detail = makeCapture(`${MAX_WINDOWED_URL}&x=1`, {
      transactions: [{ paymentDate: '2026-06-01', actualPaymentAmount: 12 }],
    });
    const picked = discoverShapeAware([empty, detail], [empty, detail], TXN_PATTERNS);
    const pickedBody = picked === false ? null : picked.responseBody;
    expect(pickedBody).toEqual(detail.responseBody);
  });
});
