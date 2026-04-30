/**
 * Unit tests for DashboardApiContext — buildApiContext + late-binding header provider.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import buildApiContext from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardApiContext.js';
import type { IFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeEndpoint, makeNetwork } from '../../../Pipeline/Strategy/StrategyTestHelpers.js';

/** Counters for fetch strategy calls. */
interface ICallCounters {
  posts: number;
  gets: number;
}

/**
 * Build a stub IFetchStrategy that records call counts.
 * @param counters - Counters object.
 * @returns Strategy stub.
 */
function makeStrategy(counters: ICallCounters): IFetchStrategy {
  return {
    /**
     * fetchPost.
     * @returns Succeed.
     */
    fetchPost: async <T>(): Promise<Procedure<T>> => {
      await Promise.resolve();
      counters.posts += 1;
      return succeed({} as T);
    },
    /**
     * fetchGet.
     * @returns Fail — test failure propagation.
     */
    fetchGet: async <T>(): Promise<Procedure<T>> => {
      await Promise.resolve();
      counters.gets += 1;
      return fail(ScraperErrorTypes.Generic, 'get-fail') as Procedure<T>;
    },
  } as unknown as IFetchStrategy;
}

describe('buildApiContext', () => {
  it('discovers no URLs when network has no endpoints', async () => {
    const network = makeNetwork();
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const strategy = makeStrategy(counters);
    const ctx = await buildApiContext(network, strategy);
    expect(ctx.accountsUrl).toBe(false);
    expect(ctx.transactionsUrl).toBe(false);
    expect(ctx.balanceUrl).toBe(false);
    expect(ctx.pendingUrl).toBe(false);
    expect(ctx.proxyUrl).toBe(false);
    expect(ctx.configTransactionsUrl).toBe(false);
  });

  it('discovers URLs from network endpoints', async () => {
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: () => makeEndpoint({ url: 'https://a.example/accts' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => makeEndpoint({ url: 'https://a.example/txn' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverBalanceEndpoint: () => makeEndpoint({ url: 'https://a.example/bal' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverByPatterns: () => makeEndpoint({ url: 'https://a.example/pend' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverProxyEndpoint: () => 'https://a.example/proxy',
    });
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const makeStrategyResult1 = makeStrategy(counters);
    const ctx = await buildApiContext(network, makeStrategyResult1);
    expect(ctx.accountsUrl).toBe('https://a.example/accts');
    expect(ctx.transactionsUrl).toBe('https://a.example/txn');
    expect(ctx.balanceUrl).toBe('https://a.example/bal');
    expect(ctx.pendingUrl).toBe('https://a.example/pend');
    expect(ctx.proxyUrl).toBe('https://a.example/proxy');
  });

  it('falls back to config transactionsPath as an absolute URL', async () => {
    const network = makeNetwork();
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const makeStrategyResult2 = makeStrategy(counters);
    const ctx = await buildApiContext(network, makeStrategyResult2, {
      baseUrl: 'https://bank.co.il',
      transactionsPath: 'https://override.example/txns',
    });
    expect(ctx.configTransactionsUrl).toBe('https://override.example/txns');
  });

  it('resolves a relative transactionsPath against the base URL', async () => {
    const network = makeNetwork();
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const makeStrategyResult3 = makeStrategy(counters);
    const ctx = await buildApiContext(network, makeStrategyResult3, {
      baseUrl: 'https://bank.co.il',
      transactionsPath: '/api/v1/txns',
    });
    expect(ctx.configTransactionsUrl).toBe('https://bank.co.il/api/v1/txns');
  });

  it('bound fetchPost delegates to the underlying strategy (late-binding headers)', async () => {
    let fetchedHeaders: unknown;
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildDiscoveredHeaders: async () => {
        await Promise.resolve();
        const opts = { extraHeaders: { 'X-Req': '1' } };
        fetchedHeaders = opts;
        return opts;
      },
    });
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const makeStrategyResult4 = makeStrategy(counters);
    const ctx = await buildApiContext(network, makeStrategyResult4);
    const result = await ctx.fetchPost<{ ok: boolean }>('https://a/b', { k: 'v' });
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
    expect(counters.posts).toBe(1);
    expect(fetchedHeaders).toEqual({ extraHeaders: { 'X-Req': '1' } });
  });

  it('bound fetchGet delegates to the underlying strategy (propagates failure)', async () => {
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildDiscoveredHeaders: () => Promise.resolve({ extraHeaders: {} }),
    });
    const counters: ICallCounters = { posts: 0, gets: 0 };
    const makeStrategyResult6 = makeStrategy(counters);
    const ctx = await buildApiContext(network, makeStrategyResult6);
    const result = await ctx.fetchGet('https://a/b');
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(false);
    expect(counters.gets).toBe(1);
  });
});
