/**
 * Wave 5 branch coverage for FrozenScrapeAction.
 * Targets: no api.has (line 40), frozenEndpoints ?? [] (73), cachedAuth ?? false
 * (74), resolveFrozenApi no api (101), txnEndpoint ?? discoverTransactions (119).
 */

import { executeFrozenDirectScrape } from '../../../../Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
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
 * Build a minimal discovery.
 * @param overrides - Parameter.
 * @returns Result.
 */
function makeDiscovery(overrides: Partial<IScrapeDiscovery> = {}): IScrapeDiscovery {
  const base: IScrapeDiscovery = {
    qualifiedCards: ['Q1'],
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

describe('FrozenScrapeAction — Wave 5 branches', () => {
  it('!api.has: skip scrape (line 54 api guard)', async () => {
    const makeDiscoveryResult1 = makeDiscovery();
    const base = makeMockContext({
      scrapeDiscovery: some(makeDiscoveryResult1),
      // no api
    });
    const makeMockActionExecutorResult2 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(base, makeMockActionExecutorResult2);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('no scrapeDiscovery: returns succeed (guard)', async () => {
    const makeApiResult4 = makeApi();
    const base = makeMockContext({ api: some(makeApiResult4) });
    const makeMockActionExecutorResult5 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(base, makeMockActionExecutorResult5);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('frozenEndpoints []: guard skips (line 56-58)', async () => {
    const makeDiscoveryResult8 = makeDiscovery({
      frozenEndpoints: [] as unknown as IScrapeDiscovery['frozenEndpoints'],
    });
    const makeApiResult7 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult7),
      scrapeDiscovery: some(makeDiscoveryResult8),
    });
    const makeMockActionExecutorResult9 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(base, makeMockActionExecutorResult9);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('both accountIds empty AND qualifiedCards empty (line 117 ??)', async () => {
    const disc = makeDiscovery({
      accountIds: [],
      qualifiedCards: [],
    });
    const makeApiResult11 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult11),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult12 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(base, makeMockActionExecutorResult12);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });

  it('cachedAuth set but frozenEndpoints empty', async () => {
    const disc = makeDiscovery({
      cachedAuth: 'Bearer xyz',
      frozenEndpoints: [] as unknown as IScrapeDiscovery['frozenEndpoints'],
    });
    const makeApiResult14 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult14),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult15 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(base, makeMockActionExecutorResult15);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
  });
});
