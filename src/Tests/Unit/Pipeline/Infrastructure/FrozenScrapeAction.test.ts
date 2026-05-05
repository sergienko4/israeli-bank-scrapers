/**
 * Unit tests for FrozenScrapeAction — guards + discovery shape checks.
 */

import { executeFrozenDirectScrape } from '../../../../Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IScrapeDiscovery,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, toActionCtx } from './TestHelpers.js';

/**
 * Build a scrape discovery with optional frozen endpoints.
 * @param frozenCount - Endpoints count (0 = no endpoints).
 * @returns IScrapeDiscovery.
 */
function makeDisc(frozenCount: number): IScrapeDiscovery {
  const endpoints = Array.from({ length: frozenCount }, () => ({
    method: 'GET',
    url: 'https://bank.example.com/accts',
    response: {},
  })) as unknown as IScrapeDiscovery['frozenEndpoints'];
  return {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
    frozenEndpoints: endpoints,
    accountIds: [],
    rawAccountRecords: [],
    txnEndpoint: false,
    cachedAuth: false,
    storageHarvest: {},
  };
}

describe('executeFrozenDirectScrape', () => {
  it('skips when no scrapeDiscovery', async () => {
    const makeMockActionExecutorResult2 = makeMockActionExecutor();
    const makeMockContextResult1 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult1, makeMockActionExecutorResult2);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('skips when no api', async () => {
    const makeDiscResult4 = makeDisc(0);
    const base = makeMockContext({ scrapeDiscovery: some(makeDiscResult4) });
    const makeMockActionExecutorResult5 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult5);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('skips when frozenEndpoints empty', async () => {
    const api = {
      /**
       * No-op post.
       * @returns Never resolved.
       */
      fetchPost: (): Promise<{ success: true; value: object }> =>
        Promise.resolve({ success: true, value: {} }),
      /**
       * No-op get.
       * @returns Empty body.
       */
      fetchGet: (): Promise<{ success: true; value: object }> =>
        Promise.resolve({ success: true, value: {} }),
      accountsUrl: false,
      transactionsUrl: false,
      balanceUrl: false,
      pendingUrl: false,
      proxyUrl: false,
    };
    const makeDiscResult7 = makeDisc(0);
    const base = makeMockContext({
      scrapeDiscovery: some(makeDiscResult7),
      api: some(api as unknown as IApiFetchContext),
    });
    const makeMockActionExecutorResult8 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult8);
    const result = await executeFrozenDirectScrape(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });
});
