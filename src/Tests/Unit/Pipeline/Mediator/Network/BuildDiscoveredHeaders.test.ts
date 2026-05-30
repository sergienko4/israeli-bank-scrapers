/**
 * Failing-first contract test per debugging-guidlines.md §1.2.
 *
 * <p>Live Hapoalim run `15-05-2026_12311649` proved: the bank's SPA
 * sends `X-XSRF-TOKEN`, `pageUuid`, `X-B3-TraceId`,
 * `Client-Version-Nbr` and a full-path `Referer` on the txn POST
 * (returns 204 / 200). SCRAPE's replay omits them — bank 302s.
 * The captured `IDiscoveredEndpoint.requestHeaders` carries these
 * headers; `buildDiscoveredHeaders` must extract and merge them
 * into `extraHeaders` so they reach `fetchPost`.
 *
 * <p>RED on prior code:
 *   - live `buildDiscoveredHeaders` doesn't call `extractSpaHeaders`
 *   - both forms overwrite `Referer` with bare origin
 *   - `browserStandard` filter drops `referer` from spa headers
 *
 * <p>GREEN after fix.
 */

import {
  createFrozenNetwork,
  type IDiscoveredEndpoint,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

const FULL_REFERER =
  'https://login.bankhapoalim.fake.example/ng-portals/rb/he/current-account/transactions';
const XSRF_TOKEN = '907fe222d7a45637f6f138c1a97924bc91e8bc23d8565e3d8ff765699475251e';
const PAGE_UUID = '/current-account/transactions';
const TRACE_ID = '1b6352a0-bcfd-4f7a-b2e6-09af1c6cb3a6';
const CLIENT_VERSION = '85.63.29';

/**
 * Build a captured POST endpoint matching the Hapoalim live shape
 * — WK-pattern URL, populated body, full set of bank-specific
 * request headers including X-XSRF-TOKEN + full-path Referer.
 * @returns Single-endpoint fixture for the frozen network.
 */
function buildHapoalimLikeCapture(): IDiscoveredEndpoint {
  const url =
    'https://login.bankhapoalim.fake.example/ServerServices/current-account/transactions' +
    '?numItemsPerPage=150&sortCode=1&retrievalEndDate=20260515&retrievalStartDate=20260415' +
    '&accountId=00-000-000000&lang=he';
  const responseBody = { transactions: [] };
  return {
    url,
    method: 'POST',
    postData: '[]',
    contentType: 'application/json; charset=UTF-8',
    requestHeaders: {
      'x-xsrf-token': XSRF_TOKEN,
      pageuuid: PAGE_UUID,
      'x-b3-traceid': TRACE_ID,
      'client-version-nbr': CLIENT_VERSION,
      referer: FULL_REFERER,
      origin: 'https://login.bankhapoalim.fake.example',
      'content-type': 'application/json;charset=UTF-8',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      cookie: 'XSRF-TOKEN=abc; session=xyz',
      host: 'login.bankhapoalim.fake.example',
      'user-agent': 'Mozilla/5.0 ...',
    },
    responseHeaders: { 'content-type': 'application/json; charset=UTF-8' },
    responseBody,
    timestamp: 1,
    captureIndex: 1,
    status: 204,
  };
}

describe("buildDiscoveredHeaders — Phase H'' captured-header pass-through", () => {
  it('BDH-XSRF-001 propagates the captured X-XSRF-TOKEN from the picked txn endpoint', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['x-xsrf-token']).toBe(XSRF_TOKEN);
  });

  it('BDH-PAGEUUID-001 propagates the captured pageUuid header', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders.pageuuid).toBe(PAGE_UUID);
  });

  it('BDH-TRACEID-001 propagates the captured X-B3-TraceId header', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['x-b3-traceid']).toBe(TRACE_ID);
  });

  it('BDH-CLIENT-VERSION-001 propagates the captured Client-Version-Nbr', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['client-version-nbr']).toBe(CLIENT_VERSION);
  });

  it('BDH-CONTENT-TYPE-001 propagates the captured content-type verbatim (no hardcoded value)', async (): Promise<void> => {
    // Critical: bank rejects mismatched Content-Type. The SPA sent
    // `application/json;charset=UTF-8` (no space, exact charset
    // casing); SCRAPE used to hardcode `application/json`. Captured
    // value MUST flow through unchanged — no normalisation, no
    // default.
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['content-type']).toBe('application/json;charset=UTF-8');
    // The hardcoded mixed-case key MUST NOT appear — its presence
    // would mean the old hardcoded fallback is still firing.
    expect(opts.extraHeaders['Content-Type']).toBeUndefined();
  });

  it('BDH-CONTENT-TYPE-002 returns NO Content-Type when SPA capture omits it (no hardcoded fallback)', async (): Promise<void> => {
    // Phase H'' contract: this module never invents a Content-Type.
    // If the captured pool didn't carry one, callers downstream are
    // responsible (or the browser fetch picks its own default).
    const capture = buildHapoalimLikeCapture();
    // Strip content-type from the fixture; everything else stays.
    const entries = Object.entries(capture.requestHeaders);
    const filtered = entries.filter(([k]): boolean => k !== 'content-type');
    const requestHeaders = Object.fromEntries(filtered);
    const stripped: IDiscoveredEndpoint = { ...capture, requestHeaders };
    const network = createFrozenNetwork([stripped], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['content-type']).toBeUndefined();
    expect(opts.extraHeaders['Content-Type']).toBeUndefined();
  });

  it('BDH-REFERER-001 uses the captured full-path Referer, NOT the bare origin', async (): Promise<void> => {
    // Critical: bank checks Referer for the page path. Bare origin
    // is what `discoverHeaderValue` returns; the captured full URL
    // is what the bank actually expects. Captured MUST win.
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(
      opts.extraHeaders.Referer === FULL_REFERER || opts.extraHeaders.referer === FULL_REFERER,
    ).toBe(true);
  });

  it('BDH-COOKIE-FILTERED-001 does NOT propagate the Cookie header (browser-managed)', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders.cookie).toBeUndefined();
    expect(opts.extraHeaders.Cookie).toBeUndefined();
  });

  it('BDH-SITEID-001 does NOT duplicate Site-Id when captured x-site-id exists', async (): Promise<void> => {
    // Critical: VisaCal 401 regression (run 14093991) — SCRAPE sent
    // BOTH `x-site-id` (lowercase, from captured SPA) AND `X-Site-Id`
    // (mixed-case, from the discoverSiteId fallback). Duplicate
    // Site-Id header → 401 Unauthorized. The captured value MUST
    // survive verbatim; the fallback MUST be suppressed when
    // spaHasAny detects any WK siteId alias in spaBase.
    const capture = buildHapoalimLikeCapture();
    const withSiteId: IDiscoveredEndpoint = {
      ...capture,
      requestHeaders: { ...capture.requestHeaders, 'x-site-id': 'SITE-CAL' },
    };
    const network = createFrozenNetwork([withSiteId], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['x-site-id']).toBe('SITE-CAL');
    expect(opts.extraHeaders['X-Site-Id']).toBeUndefined();
  });

  it('BDH-HOST-FILTERED-001 does NOT propagate the Host header (browser-managed)', async (): Promise<void> => {
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders.host).toBeUndefined();
    expect(opts.extraHeaders.Host).toBeUndefined();
  });

  it('BDH-ORIGIN-001 still sets bank-Origin fallback when captured Referer exists (CR PR #280 cycle-2 #1 — no regression)', async (): Promise<void> => {
    // Critical: the captured Hapoalim fixture has BOTH lowercase
    // `origin` (stripped by browserStandard filter) AND lowercase
    // `referer` (kept). The cycle-2 guard must use the NARROW
    // ORIGIN_KEY_HEADERS = ['origin'] check — NOT the broader
    // ORIGIN_HEADERS = ['origin','referer'] discovery chain — so the
    // captured Referer on spaBase does NOT suppress the bank-required
    // Origin fallback. Bank API requires Origin for the txn POST.
    const capture = buildHapoalimLikeCapture();
    const network = createFrozenNetwork([capture], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders.Origin).toBe('https://login.bankhapoalim.fake.example');
  });
});
