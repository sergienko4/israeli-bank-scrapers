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
 * Build a POST endpoint with the supplied request body. Used by the
 * narrowParsedToResult branch tests to feed null / array / primitive
 * JSON bodies into the SCRAPE.post template detector.
 *
 * @param postData - JSON body string to attach to the endpoint.
 * @returns Discovered endpoint stub.
 */
function makePostEndpoint(postData: string): IDiscoveredEndpoint {
  return {
    url: 'https://bank.example/api/getBalance',
    method: 'POST',
    postData,
    responseBody: null,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 1,
  };
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
    const getEp: IDiscoveredEndpoint = {
      url: 'https://bank.example/something/UNRELATED?q=1',
      method: 'GET',
      postData: '',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
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
    const putEp: IDiscoveredEndpoint = {
      url: 'https://bank.example/api/something',
      method: 'PUT',
      postData: '',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
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
});
