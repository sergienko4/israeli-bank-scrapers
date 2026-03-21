/**
 * Unit tests for ScrapeExecutor.ts — POST transactions and recursive failure branches.
 * Supplements ScrapeExecutor.test.ts (which covers GET path and basic error propagation).
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { executeScrape } from '../../../../../Scrapers/Pipeline/Phases/ScrapeExecutor.js';
import type { IFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/FetchStrategy.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockContext,
  makeMockFetchStrategy,
  makeMockScrapeConfig,
  MOCK_RAW_ACCOUNT,
} from '../MockPipelineFactories.js';

/**
 * Create a context with the given fetch strategy.
 * @param strategy - Fetch strategy to inject.
 * @returns Context with fetchStrategy:some(strategy).
 */
const MAKE_CTX = (strategy = makeMockFetchStrategy()): ReturnType<typeof makeMockContext> => {
  const fetchSome = some(strategy);
  return makeMockContext({ fetchStrategy: fetchSome });
};

describe('ScrapeExecutor/POST-transactions', () => {
  it('calls fetchPost for POST transactions config', async () => {
    const postPaths: string[] = [];
    const strategy = {
      /**
       * Stub fetchGet for accounts.
       * @returns Succeed procedure.
       */
      fetchGet: <T>() => {
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
      /**
       * Capture POST txn paths.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchPost: <T>(path: string) => {
        postPaths.push(path);
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
    } as unknown as IFetchStrategy;
    const config = {
      ...makeMockScrapeConfig([MOCK_RAW_ACCOUNT]),
      transactions: {
        method: 'POST' as const,
        /**
         * Build POST request for one account.
         * @param accountId - Account identifier.
         * @returns Request with path and postData.
         */
        buildRequest: (accountId: string): { path: string; postData: Record<string, string> } => ({
          path: `/api/txns/${accountId}`,
          postData: { id: accountId },
        }),
        /**
         * Map transaction response.
         * @returns Empty transactions array.
         */
        mapper: (): never[] => [],
      },
    };
    const ctx = MAKE_CTX(strategy);
    await executeScrape(ctx, config);
    const hasTxnPost = postPaths.some(p => p.includes('/api/txns/'));
    expect(hasTxnPost).toBe(true);
  });
});

describe('ScrapeExecutor/2nd-account-failure', () => {
  it('propagates failure on 2nd account transaction fetch', async () => {
    let txnCallCount = 0;
    const strategy = {
      /**
       * Succeed for accounts, fail on 2nd txn fetch.
       * @param path - URL path.
       * @returns Succeed or fail procedure.
       */
      fetchGet: <T>(path: string) => {
        if (path.includes('/api/txns/')) {
          txnCallCount += 1;
          if (txnCallCount >= 2) {
            const r = fail(ScraperErrorTypes.Generic, '2nd account txn failed');
            return Promise.resolve(r);
          }
        }
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
      /**
       * Stub fetchPost.
       * @returns Succeed procedure.
       */
      fetchPost: <T>() => {
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
    } as unknown as IFetchStrategy;
    const accounts = [
      { accountId: 'A1', balance: 100 },
      { accountId: 'A2', balance: 200 },
    ];
    const config = makeMockScrapeConfig(accounts);
    const ctx = MAKE_CTX(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('2nd account txn failed');
  });
});

describe('ScrapeExecutor/balanceExtractor', () => {
  it('uses balanceExtractor when provided', async () => {
    const strategy = makeMockFetchStrategy();
    const config = {
      ...makeMockScrapeConfig(),
      /**
       * Extract balance from txn response.
       * @returns Fixed balance for testing.
       */
      balanceExtractor: (): number => 9999,
    };
    const ctx = MAKE_CTX(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const acct = result.value.scrape;
    if (!acct.has) return;
    expect(acct.value.accounts[0].balance).toBe(9999);
  });

  it('falls back to account.balance when extractor absent', async () => {
    const strategy = makeMockFetchStrategy();
    const config = makeMockScrapeConfig();
    const ctx = MAKE_CTX(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const acct = result.value.scrape;
    if (!acct.has) return;
    expect(acct.value.accounts[0].balance).toBe(1000);
  });
});
