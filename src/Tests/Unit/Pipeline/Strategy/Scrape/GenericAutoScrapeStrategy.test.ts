/**
 * Unit tests for Strategy/Scrape/GenericAutoScrapeStrategy.
 * Covers helper functions + genericAutoScrape dispatch paths (guard branches).
 */

import {
  applyCredentialFallback,
  buildLoadAllCtx,
  discoverAndLoadAccounts,
  loadDiscovered,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import type { IFetchAllAccountsCtx } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchGetOk,
  stubFetchPostOk,
} from '../StrategyTestHelpers.js';

describe('loadDiscovered', () => {
  it('returns buffered response when endpoint has responseBody', async () => {
    const api = makeApi();
    const ep = makeEndpoint({ responseBody: { foo: 'bar' } });
    const result = await loadDiscovered<Record<string, unknown>>(api, ep);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('re-fetches via POST when no response body (POST endpoint)', async () => {
    const api = makeApi({ fetchPost: stubFetchPostOk({ re: 'fetched' }) });
    const ep = makeEndpoint({
      method: 'POST',
      postData: '{"foo":1}',
      responseBody: undefined,
    });
    const result = await loadDiscovered<Record<string, unknown>>(api, ep);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('re-fetches via GET when no response body (GET endpoint)', async () => {
    const api = makeApi({ fetchGet: stubFetchGetOk({ re: 'got' }) });
    const ep = makeEndpoint({
      method: 'GET',
      postData: '',
      responseBody: undefined,
    });
    const result = await loadDiscovered<Record<string, unknown>>(api, ep);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('handles empty postData by defaulting to {} for POST', async () => {
    const api = makeApi({ fetchPost: stubFetchPostOk({ ok: true }) });
    const ep = makeEndpoint({
      method: 'POST',
      postData: '',
      responseBody: undefined,
    });
    const result = await loadDiscovered<Record<string, unknown>>(api, ep);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });
});

describe('discoverAndLoadAccounts', () => {
  it('returns empty record when no accounts endpoint discoverable', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: () => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverEndpointByContent: () => false,
    });
    const result = await discoverAndLoadAccounts(api, network);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('uses accounts endpoint when discovered', async () => {
    const api = makeApi();
    const ep = makeEndpoint({ responseBody: { accounts: [] } });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: () => ep,
    });
    const result = await discoverAndLoadAccounts(api, network);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('falls back to content discovery when URL discovery fails', async () => {
    const api = makeApi();
    const ep = makeEndpoint({ responseBody: { accountId: 'a1' } });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: () => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverEndpointByContent: () => ep,
    });
    const result = await discoverAndLoadAccounts(api, network);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });
});

describe('buildLoadAllCtx', () => {
  it('produces ctx from empty raw accounts with no txn endpoint', () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toHaveLength(0);
    expect(result.records).toHaveLength(0);
  });

  it('applies POST body fallback when raw accounts are empty and postData has cards', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cards":[{"cardUniqueId":"card-1"}]}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('applies POST body fallback when postData has top-level cardUniqueId', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cardUniqueId":"card-top"}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('ignores invalid JSON postData gracefully', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({ method: 'POST', postData: 'not-json' });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toHaveLength(0);
  });
});

describe('applyCredentialFallback', () => {
  it('returns unchanged when ids already exist', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const ctx: IFetchAllAccountsCtx = {
      fc,
      ids: ['a'],
      records: [{ id: 'a' }],
      txnEndpoint: false,
    };
    const pipeline = makeMockContext();
    const result = applyCredentialFallback(ctx, pipeline);
    expect(result.ids).toEqual(['a']);
  });

  it('returns unchanged when no txn endpoint buffer', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const ctx: IFetchAllAccountsCtx = {
      fc,
      ids: [],
      records: [],
      txnEndpoint: false,
    };
    const pipeline = makeMockContext();
    const result = applyCredentialFallback(ctx, pipeline);
    expect(result.ids).toEqual([]);
  });

  it('uses credential card6Digits when ids empty + txn buffer exists', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const txnEp = makeEndpoint({ responseBody: { ok: true } });
    const ctx: IFetchAllAccountsCtx = {
      fc,
      ids: [],
      records: [],
      txnEndpoint: txnEp,
    };
    const pipeline = makeMockContext({
      credentials: {
        username: 'u',
        password: 'p',
        card6Digits: '123456',
      } as unknown as IPipelineContext['credentials'],
    });
    const result = applyCredentialFallback(ctx, pipeline);
    expect(result.ids).toEqual(['123456']);
  });

  it('uses "default" when card6Digits is missing', () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const txnEp = makeEndpoint({ responseBody: { ok: true } });
    const ctx: IFetchAllAccountsCtx = {
      fc,
      ids: [],
      records: [],
      txnEndpoint: txnEp,
    };
    const pipeline = makeMockContext();
    const result = applyCredentialFallback(ctx, pipeline);
    expect(result.ids).toEqual(['default']);
  });
});
