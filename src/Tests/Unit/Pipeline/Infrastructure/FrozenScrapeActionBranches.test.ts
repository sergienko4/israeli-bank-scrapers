/**
 * Branch coverage extensions for FrozenScrapeAction.
 * Exercises the happy path with real api + frozen endpoints + discovery fallback branches.
 */

import { executeFrozenDirectScrape } from '../../../../Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IScrapeDiscovery,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, toActionCtx } from './TestHelpers.js';

/**
 * Build a stub API context.
 * @returns Result.
 */
function makeApi(): IApiFetchContext {
  return {
    /**
     * Succeed GET.
     * @returns Resolved.
     */
    fetchGet: () => {
      const okGet = succeed({});
      return Promise.resolve(okGet);
    },
    /**
     * Succeed POST.
     * @returns Resolved.
     */
    fetchPost: () => {
      const okPost = succeed({});
      return Promise.resolve(okPost);
    },
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

/**
 * Build a minimal discovery with one frozen endpoint.
 * @param overrides - Parameter.
 * @returns Result.
 */
function makeDiscovery(overrides: Partial<IScrapeDiscovery> = {}): IScrapeDiscovery {
  const base: IScrapeDiscovery = {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
    frozenEndpoints: [
      {
        method: 'GET',
        url: 'https://bank.example.com/accounts',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 0,
      },
    ] as unknown as IScrapeDiscovery['frozenEndpoints'],
    accountIds: [],
    rawAccountRecords: [],
    txnEndpoint: false,
    cachedAuth: false,
    storageHarvest: {},
  };
  return { ...base, ...overrides };
}

describe('executeFrozenDirectScrape — branch paths', () => {
  it('runs frozen scrape when api + frozenEndpoints present + empty account lists', async () => {
    const makeDiscoveryResult2 = makeDiscovery();
    const makeApiResult1 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult1),
      scrapeDiscovery: some(makeDiscoveryResult2),
    });
    const makeMockActionExecutorResult3 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult3);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('uses accountIds when provided (overrides qualifiedCards)', async () => {
    const disc = makeDiscovery({
      qualifiedCards: ['ignored'],
      accountIds: ['accountIds-wins'],
    });
    const makeApiResult5 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult5),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult6 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult6);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('falls back to qualifiedCards when accountIds missing (undefined)', async () => {
    const disc = makeDiscovery({
      qualifiedCards: ['fallback-a'],
      accountIds: undefined,
    });
    const makeApiResult8 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult8),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult9 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult9);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('uses cachedAuth string when provided', async () => {
    const disc = makeDiscovery({
      cachedAuth: 'Bearer abc',
      frozenEndpoints: [
        {
          method: 'GET',
          url: 'https://bank.example.com/x',
          postData: '',
          responseBody: {},
          contentType: 'application/json',
          requestHeaders: {},
          responseHeaders: {},
          timestamp: 0,
        },
      ] as unknown as IScrapeDiscovery['frozenEndpoints'],
    });
    const makeApiResult11 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult11),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult12 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult12);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });

  it('uses txnEndpoint from discovery when set', async () => {
    const disc = makeDiscovery({
      accountIds: ['A1'],
      rawAccountRecords: [{ accountNumber: 'A1' }],
      txnEndpoint: {
        method: 'POST',
        url: 'https://bank.example.com/txn',
        postData: '{"accountNumber":"A1"}',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 0,
      } as unknown as IScrapeDiscovery['txnEndpoint'],
    });
    const makeApiResult14 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult14),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult15 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult15);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
  });

  it('works with rawAccountRecords missing from discovery (fallback empty)', async () => {
    const disc = makeDiscovery({ rawAccountRecords: undefined });
    const makeApiResult17 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult17),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult18 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult18);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
  });

  it('runs with frozenEndpoints missing (undefined → fallback empty)', async () => {
    const disc = makeDiscovery({ frozenEndpoints: undefined });
    const makeApiResult20 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult20),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult21 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult21);
    const result = await executeFrozenDirectScrape(ctx);
    // With frozenEps empty, guard returns succeed.
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
  });

  it('runFrozenScrape: cachedAuth undefined → fallback false (L74:7:1)', async () => {
    const disc = makeDiscovery({ cachedAuth: undefined, accountIds: ['X'] });
    const makeApiResult23 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult23),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult24 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult24);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult25 = isOk(result);
    expect(isOkResult25).toBe(true);
  });

  it('runFrozenScrape: txnEndpoint undefined → falls back to frozen.discoverTransactionsEndpoint (L119:11:1)', async () => {
    const disc = makeDiscovery({
      accountIds: ['A1'],
      rawAccountRecords: [{ accountNumber: 'A1' }],
      txnEndpoint: undefined, // triggers ?? right side
    });
    const makeApiResult26 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult26),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult27 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult27);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult28 = isOk(result);
    expect(isOkResult28).toBe(true);
  });
});
