/**
 * Branch recovery #3 for GenericAutoScrapeStrategy.
 * Targets:
 *  - L308 `!ctx.browser.has` true: applyStorageHarvest guard path
 *  - L311 `result.ids.length===0` false: storage harvest finds accounts
 *  - L334/L335/L336 guard branches (api/mediator/browser none)
 */

import {
  applyCredentialFallback,
  buildLoadAllCtx,
  discoverAndLoadAccounts,
  genericAutoScrape,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { none } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeApi, makeEndpoint, makeFc, makeNetwork } from '../StrategyTestHelpers.js';

describe('GenericAutoScrapeStrategy — branch recovery #3', () => {
  it('genericAutoScrape: no api → succeed pass-through (L334 true)', async () => {
    const ctx = { ...makeMockContext(), api: none() };
    const result = await genericAutoScrape(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('genericAutoScrape: no mediator → succeed pass-through (L335 true)', async () => {
    const api = makeApi();
    const ctx = { ...makeMockContext(), api: { has: true as const, value: api } };
    const result = await genericAutoScrape(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('applyCredentialFallback: ids empty + no responseBody → passes through unchanged', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const endpoint = makeEndpoint({ responseBody: undefined });
    const loadCtx = { fc, ids: [], records: [], txnEndpoint: endpoint };
    const ctx = makeMockContext();
    const updated = applyCredentialFallback(loadCtx, ctx);
    expect(updated.ids).toEqual([]);
  });

  it('applyCredentialFallback: ids non-empty → passes through without modification', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const endpoint = makeEndpoint({ responseBody: { foo: 'bar' } });
    const loadCtx = { fc, ids: ['ACC1'], records: [{ foo: 'bar' }], txnEndpoint: endpoint };
    const ctx = makeMockContext();
    const updated = applyCredentialFallback(loadCtx, ctx);
    expect(updated.ids).toEqual(['ACC1']);
  });

  it('discoverAndLoadAccounts: content-based discovery path (byContent truthy)', async () => {
    // Endpoint has buffered response matching account signature keys (accountId).
    const contentEp = makeEndpoint({
      url: 'https://bank.example/api/accountlist',
      method: 'GET',
      responseBody: { result: [{ accountId: 'A1' }] },
    });
    const api = makeApi();
    const network = makeNetwork({
      /**
       * No URL-pattern discovery.
       * @returns false.
       */
      discoverAccountsEndpoint: () => false,
      /**
       * Content-based discovery returns the endpoint.
       * @returns The endpoint with account signature.
       */
      discoverEndpointByContent: () => contentEp,
    });
    const result = await discoverAndLoadAccounts(api, network);
    // buffered response used — no network call.
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('buildLoadAllCtx: ids empty + records empty + txnEndpoint with postData → POST body fallback', () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Return a txn endpoint with postData containing accountId.
       * @returns Endpoint.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://bank.example/api/txn',
          method: 'POST',
          postData: '{"accountId":"A9","from":"20260101"}',
        }),
    });
    const fc = makeFc(api, network);
    const rawAccounts = {}; // no accounts, no records
    const loadCtx = buildLoadAllCtx(fc, network, rawAccounts);
    // POST body fallback path activates
    expect(loadCtx.ids.length).toBeGreaterThan(0);
  });
});
