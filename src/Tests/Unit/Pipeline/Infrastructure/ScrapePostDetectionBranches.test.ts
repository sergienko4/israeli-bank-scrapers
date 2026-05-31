/**
 * SCRAPE.post template-detection branch coverage (v6).
 *
 * <p>Pins the otherwise-unreachable defensive branches inside
 * `discoverBalanceFetchTemplate` + `narrowParsedToResult` —
 * malformed-JSON / null / array / primitive POST bodies, GET
 * path-tail not in ids, records.length < ids.length. Split out of
 * ScrapePhaseActionsWave5.test.ts so neither file exceeds the
 * per-file max-lines limit.
 */

import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { executeStampAccounts } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IAccountDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../Helpers/AssertProcedure.js';
import { makeMockContext } from './MockFactories.js';
import { makeMediatorWithPool, makeSingleAccountDiscovery } from './ScrapeMockHelpers.js';

/**
 * Build a discovered endpoint with the supplied HTTP method, URL, and
 * (for POST) request body. Single factory used by all branch tests in
 * this file to avoid repeated `IDiscoveredEndpoint` object literals
 * (CR #281 C9 nitpick — DRY fixture).
 *
 * @param method - HTTP method.
 * @param url - Endpoint URL.
 * @param postData - Optional POST body string (default `''`).
 * @returns Discovered endpoint stub.
 */
function makeEndpoint(
  method: IDiscoveredEndpoint['method'],
  url: string,
  postData = '',
): IDiscoveredEndpoint {
  return {
    url,
    method,
    postData,
    responseBody: null,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 1,
  };
}

/**
 * Build a POST endpoint with the supplied request body. Thin wrapper
 * around {@link makeEndpoint} kept for call-site readability in the
 * narrowParsedToResult branch tests.
 *
 * @param postData - JSON body string to attach to the endpoint.
 * @returns Discovered endpoint stub.
 */
function makePostEndpoint(postData: string): IDiscoveredEndpoint {
  return makeEndpoint('POST', 'https://bank.example/api/getBalance', postData);
}

/**
 * Build a GET endpoint at the supplied URL. Thin wrapper around
 * {@link makeEndpoint} kept for call-site readability in the
 * `replaceLastPathSegment` branch tests.
 *
 * @param url - Endpoint URL.
 * @returns Discovered endpoint stub.
 */
function makeGetEndpoint(url: string): IDiscoveredEndpoint {
  return makeEndpoint('GET', url);
}

/**
 * Wrap a single-endpoint pool + ACC-001 identity into a stamp-ready
 * pipeline context.
 *
 * @param ep - Endpoint to expose via the mediator.
 * @returns Pipeline context primed for executeStampAccounts.
 */
function makeStampCtx(ep: IDiscoveredEndpoint): Parameters<typeof executeStampAccounts>[0] {
  const mediator = makeMediatorWithPool([ep]);
  const accountDiscovery = makeSingleAccountDiscovery('ACC-001', {});
  return makeMockContext({
    scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
    mediator: some(mediator),
    accountDiscovery,
  });
}

describe('ScrapePhaseActions — SCRAPE.post detection branch coverage (v6)', () => {
  it('POST endpoint with malformed JSON body → cascades to bulk template (parsed.size=0 branch)', async () => {
    const ep = makePostEndpoint('{ malformed json');
    const ctx = makeStampCtx(ep);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.postBodyKey).toBeUndefined();
    }
  });

  it('POST endpoint with array JSON body → narrowParsedToResult array branch', async () => {
    const ep = makePostEndpoint('[1,2,3]');
    const ctx = makeStampCtx(ep);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
  });

  it('POST endpoint with null JSON body → narrowParsedToResult null branch', async () => {
    const ep = makePostEndpoint('null');
    const ctx = makeStampCtx(ep);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
  });

  it('POST endpoint with primitive JSON body → narrowParsedToResult primitive branch', async () => {
    const ep = makePostEndpoint('42');
    const ctx = makeStampCtx(ep);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
  });

  it('GET endpoint with path-tail NOT in ids → cascades to bulk template', async () => {
    const getEp = makeGetEndpoint('https://bank.example/something/UNRELATED?q=1');
    const ctx = makeStampCtx(getEp);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('GET');
      expect(tmpl?.urlPathInterpolation).toBeUndefined();
    }
  });

  it('pool with only non-GET/POST endpoints (PUT/PATCH) → no balanceFetchTemplate emitted', async () => {
    const putEp = makeEndpoint('PUT', 'https://bank.example/api/something');
    const ctx = makeStampCtx(putEp);
    const result = await executeStampAccounts(ctx);
    assertOk(result);
    assertHas(result.value.scrape);
    const tmpl = result.value.scrape.value.balanceFetchTemplate;
    expect(tmpl).toBeUndefined();
  });

  it('records.length < ids.length → buildAccountIdentities records[i] ?? {} fallback', async () => {
    const mediator = makeMediatorWithPool([]);
    const discovery: IAccountDiscovery = {
      ids: ['ID-1', 'ID-2'],
      records: [{ cardUniqueId: 'UID-1' }],
      containers: {},
      endpointCaptureIndex: 0,
    };
    const ctx = makeMockContext({
      scrape: some({
        accounts: [
          { accountNumber: 'ID-1', balance: 0, txns: [] },
          { accountNumber: 'ID-2', balance: 0, txns: [] },
        ],
      }),
      mediator: some(mediator),
      accountDiscovery: some(discovery),
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const id2 = result.value.scrape.value.accountIdentities?.get('ID-2');
      expect(id2?.cardUniqueId).toBe('ID-2');
    }
  });

  // ── PR #281 CR-1 branch coverage: replaceLastPathSegment WITHOUT query ──

  it('GET endpoint with path-tail in ids AND no query string → replaces last segment, no query carry', async () => {
    const getEp = makeGetEndpoint('https://bank.example/api/accounts/ACC-001');
    const ctx = makeStampCtx(getEp);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('GET');
      expect(tmpl?.url).toBe('https://bank.example/api/accounts/<ID>');
      expect(tmpl?.urlPathInterpolation).toBe(true);
    }
  });

  it('GET endpoint with path-tail in ids AND query string → replaces last segment, preserves query', async () => {
    const getEp = makeGetEndpoint('https://bank.example/api/accounts/ACC-001?include=balance');
    const ctx = makeStampCtx(getEp);
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('GET');
      expect(tmpl?.url).toBe('https://bank.example/api/accounts/<ID>?include=balance');
      expect(tmpl?.urlPathInterpolation).toBe(true);
    }
  });
});
