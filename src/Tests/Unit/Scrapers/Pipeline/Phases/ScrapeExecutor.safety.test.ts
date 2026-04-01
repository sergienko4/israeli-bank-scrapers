/**
 * Unit tests for ScrapeExecutor — bank callback safety.
 * Verifies that throwing mappers/buildRequest are caught as Procedure failures.
 */

import { executeScrape } from '../../../../../Scrapers/Pipeline/Strategy/ScrapeExecutor.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IScrapeConfig } from '../../../../../Scrapers/Pipeline/Types/ScrapeConfig.js';
import {
  makeMockContext,
  makeMockFetchStrategy,
  makeMockScrapeConfig,
} from '../MockPipelineFactories.js';

/**
 * Create a context with a given fetch strategy.
 * @param strategy - Fetch strategy to inject.
 * @returns Context with fetchStrategy as some().
 */
const MAKE_CTX = (strategy = makeMockFetchStrategy()): ReturnType<typeof makeMockContext> => {
  const fetchSome = some(strategy);
  return makeMockContext({ fetchStrategy: fetchSome });
};

describe('ScrapeExecutor/callback-safety', () => {
  it('catches throwing account mapper and returns failure', async () => {
    const strategy = makeMockFetchStrategy();
    const ctx = MAKE_CTX(strategy);
    const base = makeMockScrapeConfig();
    const config: IScrapeConfig<object, object> = {
      ...base,
      accounts: {
        ...base.accounts,
        /** Throws TypeError to simulate bad API response shape. */
        mapper: () => {
          throw new TypeError('bad account shape');
        },
      },
    };
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('Account mapper failed');
  });

  it('catches throwing transaction mapper and returns failure', async () => {
    const strategy = makeMockFetchStrategy();
    const ctx = MAKE_CTX(strategy);
    const base = makeMockScrapeConfig();
    const config: IScrapeConfig<object, object> = {
      ...base,
      transactions: {
        ...base.transactions,
        /** Throws TypeError to simulate bad API response shape. */
        mapper: () => {
          throw new TypeError('bad txn shape');
        },
      },
    };
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('Transaction mapper failed');
  });

  it('catches throwing buildRequest and returns failure', async () => {
    const strategy = makeMockFetchStrategy();
    const ctx = MAKE_CTX(strategy);
    const base = makeMockScrapeConfig();
    const config: IScrapeConfig<object, object> = {
      ...base,
      transactions: {
        ...base.transactions,
        /** Throws TypeError to simulate bad request build. */
        buildRequest: () => {
          throw new TypeError('bad request');
        },
      },
    };
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('buildRequest failed');
  });

  it('catches throwing extraHeaders and uses default opts', async () => {
    const strategy = makeMockFetchStrategy();
    const ctx = MAKE_CTX(strategy);
    const base = makeMockScrapeConfig();
    const config: IScrapeConfig<object, object> = {
      ...base,
      /** Throws TypeError to simulate broken header factory. */
      extraHeaders: () => {
        throw new TypeError('header factory broke');
      },
    };
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
  });
});
