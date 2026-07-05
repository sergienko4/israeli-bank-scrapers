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

// --- BaNCS (Yahav) /account body-shape header fallback ---------------

/**
 * RED→GREEN per debugging-guidlines.md §1.2.
 *
 * <p>Live Yahav run `04-07-2026_12401872` proved: the BaNCS txn
 * replay POST is WAF/BaNCS-rejected (HTTP 200 HTML
 * `לא ניתן להשלים בקשה`) because it carries only Origin+Referer —
 * the SPA's `x-xsrf-token`, `bd_ident_key`, `content-type` and
 * `accept` are dropped. Root cause: `extractSpaHeaders` finds the
 * txn endpoint by URL-well-known ONLY, and BaNCS multiplexes txns
 * through `POST …/BaNCSDigitalApp/account` — a URL that matches no
 * WK txn pattern — so it hit `return {}` and forwarded nothing.
 *
 * <p>The captured `/account` request headers DO carry these
 * (session-scoped, not single-use) values; the body-shape fallback
 * ({@link isBancsTxnCapture}) must locate that capture so its custom
 * headers reach the replay. Default-deny: a non-txn `/account` body
 * (e.g. `portfolioBalance`) must still forward nothing.
 */
const BANCS_XSRF = 'fake-xsrf-token-0000';
const BANCS_BD_IDENT = 'fake-bd-ident-key-0000';
const BANCS_CONTENT_TYPE = 'application/json;charset=utf-8';
const BANCS_TXN_BODY = JSON.stringify({
  Payload: {
    Category: ['CURRENT_ACCOUNT'],
    Filters: [
      {
        Filters: [
          { OrigDt: { Day: 3, Month: 4, Year: 2026 }, Operator: 'GREATERTHANEQUALTO' },
          { OrigDt: { Day: 3, Month: 7, Year: 2026 }, Operator: 'LESSTHANEQUALTO' },
        ],
      },
    ],
  },
});
const BANCS_BALANCE_BODY = JSON.stringify({ Payload: { Category: ['portfolioBalance'] } });

/**
 * Build a captured BaNCS `/account` POST — a URL that matches NO
 * well-known txn pattern, so only the body-shape fallback can find
 * it — carrying the SPA's session-scoped security headers.
 * @param postData - Request body (defaults to a CURRENT_ACCOUNT query).
 * @returns Single-endpoint fixture for the frozen network.
 */
function buildBancsTxnCapture(postData: string = BANCS_TXN_BODY): IDiscoveredEndpoint {
  return {
    url: 'https://digital.yahav.fake.example/BaNCSDigitalApp/account',
    method: 'POST',
    postData,
    contentType: BANCS_CONTENT_TYPE,
    requestHeaders: {
      'content-type': BANCS_CONTENT_TYPE,
      accept: 'application/json, text/plain, */*',
      'x-xsrf-token': BANCS_XSRF,
      bd_ident_key: BANCS_BD_IDENT,
      referer: 'https://digital.yahav.fake.example/BaNCSDigitalApp/index.html',
      origin: 'https://digital.yahav.fake.example',
      cookie: 'XSRF-TOKEN=abc; SMSESSION=xyz',
      host: 'digital.yahav.fake.example',
      'user-agent': 'Mozilla/5.0 ...',
    },
    responseHeaders: { 'content-type': 'application/json; charset=UTF-8' },
    responseBody: { Payload: { DataEntity: [] } },
    timestamp: 2,
    captureIndex: 2,
    status: 200,
  };
}

describe('buildDiscoveredHeaders — BaNCS /account body-shape header fallback', () => {
  it('BDH-BANCS-XSRF-001 forwards x-xsrf-token from a BaNCS /account txn capture (no URL-WK match)', async (): Promise<void> => {
    const network = createFrozenNetwork([buildBancsTxnCapture()], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['x-xsrf-token']).toBe(BANCS_XSRF);
  });

  it('BDH-BANCS-IDENT-001 forwards the bd_ident_key identity token from the BaNCS capture', async (): Promise<void> => {
    const network = createFrozenNetwork([buildBancsTxnCapture()], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders.bd_ident_key).toBe(BANCS_BD_IDENT);
  });

  it('BDH-BANCS-CONTENT-TYPE-001 forwards the BaNCS content-type verbatim', async (): Promise<void> => {
    const network = createFrozenNetwork([buildBancsTxnCapture()], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['content-type']).toBe(BANCS_CONTENT_TYPE);
  });

  it('BDH-BANCS-DENY-001 forwards NO SPA security headers for a non-txn /account body (default-deny)', async (): Promise<void> => {
    const network = createFrozenNetwork([buildBancsTxnCapture(BANCS_BALANCE_BODY)], false);

    const opts = await network.buildDiscoveredHeaders();

    expect(opts.extraHeaders['x-xsrf-token']).toBeUndefined();
    expect(opts.extraHeaders.bd_ident_key).toBeUndefined();
  });
});
