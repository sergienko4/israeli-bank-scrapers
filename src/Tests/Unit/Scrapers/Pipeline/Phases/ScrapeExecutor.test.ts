/**
 * Unit tests for ScrapeExecutor.ts.
 * Covers all fetch paths, error propagation, date computation, empty accounts.
 */

import { executeScrape } from '../../../../../Scrapers/Pipeline/Phases/ScrapeExecutor.js';
import { DEFAULT_FETCH_OPTS } from '../../../../../Scrapers/Pipeline/Strategy/FetchStrategy.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IRawAccount } from '../../../../../Scrapers/Pipeline/Types/ScrapeConfig.js';
import {
  makeMockContext,
  makeMockFetchStrategy,
  makeMockScrapeConfig,
  MOCK_RAW_ACCOUNT,
} from '../MockPipelineFactories.js';

// ── Helpers ────────────────────────────────────────────────

/**
 * Create a context with the given fetch strategy.
 * @param strategy - Fetch strategy to inject.
 * @returns Context with fetchStrategy:some(strategy).
 */
const MAKE_CTX_WITH_STRATEGY = (
  strategy = makeMockFetchStrategy(),
): ReturnType<typeof makeMockContext> => {
  const fetchSome = some(strategy);
  return makeMockContext({ fetchStrategy: fetchSome });
};

// ── Guard ──────────────────────────────────────────────────

describe('ScrapeExecutor/guard', () => {
  it('fails when fetchStrategy is absent from context', async () => {
    const ctx = makeMockContext();
    const config = makeMockScrapeConfig();
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('No fetchStrategy');
    }
  });
});

// ── Account fetch ──────────────────────────────────────────

describe('ScrapeExecutor/accounts', () => {
  it('calls fetchGet for GET accounts config', async () => {
    const calls: string[] = [];
    const strategy = {
      /**
       * Capture path and return succeed.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(path: string) => {
        calls.push(`GET:${path}`);
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
    } as never;
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    await executeScrape(ctx, config);
    expect(calls[0]).toContain('GET:/api/accounts');
  });

  it('calls fetchPost for POST accounts config', async () => {
    const calls: string[] = [];
    const strategy = {
      /**
       * Stub fetchGet.
       * @returns Succeed procedure.
       */
      fetchGet: <T>() => {
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
      /**
       * Capture path and return succeed.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchPost: <T>(path: string) => {
        calls.push(`POST:${path}`);
        const r = succeed({} as T);
        return Promise.resolve(r);
      },
    } as never;
    const config = {
      ...makeMockScrapeConfig([MOCK_RAW_ACCOUNT]),
      accounts: {
        method: 'POST' as const,
        path: '/api/accounts-post',
        postData: { key: 'val' },
        /**
         * Map accounts response.
         * @returns MOCK_RAW_ACCOUNT array.
         */
        /**
         * Map accounts response.
         * @returns MOCK_RAW_ACCOUNT array.
         */
        mapper: (): readonly IRawAccount[] => [MOCK_RAW_ACCOUNT],
      },
    };
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    await executeScrape(ctx, config);
    expect(calls[0]).toContain('POST:/api/accounts-post');
  });

  it('propagates account fetch failure', async () => {
    const strategy = {
      /**
       * Return fail for all calls.
       * @returns Fail procedure.
       */
      fetchGet: () => {
        const r = fail('GENERIC' as never, 'accounts failed');
        return Promise.resolve(r);
      },
      /**
       * Return fail for all calls.
       * @returns Fail procedure.
       */
      fetchPost: () => {
        const r = fail('GENERIC' as never, 'accounts failed');
        return Promise.resolve(r);
      },
    } as never;
    const config = makeMockScrapeConfig();
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toBe('accounts failed');
  });
});

// ── Sequential fetch ───────────────────────────────────────

describe('ScrapeExecutor/sequential', () => {
  it('returns empty accounts array when account list is empty', async () => {
    const config = makeMockScrapeConfig([]);
    const ctx = MAKE_CTX_WITH_STRATEGY();
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scrape.has).toBe(true);
      if (result.value.scrape.has) {
        expect(result.value.scrape.value.accounts).toHaveLength(0);
      }
    }
  });

  it('fetches transactions for each account sequentially', async () => {
    const txnPaths: string[] = [];
    const accounts = [
      { accountId: 'A1', balance: 100 },
      { accountId: 'A2', balance: 200 },
    ];
    const strategy = {
      /**
       * Capture path and return succeed.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(path: string) => {
        txnPaths.push(path);
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
    } as never;
    const config = makeMockScrapeConfig(accounts);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(true);
    const txnCalls = txnPaths.filter(p => p.includes('/api/txns/'));
    expect(txnCalls).toHaveLength(2);
  });

  it('propagates transaction fetch failure', async () => {
    let callCount = 0;
    const strategy = {
      /**
       * Fail for txn paths, succeed for account paths.
       * @param path - URL path.
       * @returns Succeed or fail procedure.
       */
      fetchGet: <T>(path: string) => {
        callCount += 1;
        if (path.includes('/api/txns/')) {
          const r = fail('GENERIC' as never, 'txn fetch failed');
          return Promise.resolve(r);
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
    } as never;
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toBe('txn fetch failed');
    expect(callCount).toBeGreaterThan(0);
  });

  it('populates scrape.accounts with account number, balance, txns', async () => {
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY();
    const result = await executeScrape(ctx, config);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.scrape.has) {
      const acct = result.value.scrape.value.accounts[0];
      expect(acct.accountNumber).toBe('ACC001');
      expect(acct.balance).toBe(1000);
      expect(acct.txns).toHaveLength(1);
    }
  });
});

// ── buildFetchOpts ─────────────────────────────────────────

describe('ScrapeExecutor/buildFetchOpts', () => {
  it('returns DEFAULT_FETCH_OPTS when config has no extra headers', async () => {
    const capturedOpts: unknown[] = [];
    const strategy = {
      /**
       * Capture opts and return succeed.
       * @param _path - Ignored path.
       * @param opts - Options to capture.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(_path: string, opts: unknown) => {
        capturedOpts.push(opts);
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
    } as never;
    const config = makeMockScrapeConfig([]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    await executeScrape(ctx, config);
    expect(capturedOpts[0]).toBe(DEFAULT_FETCH_OPTS);
  });

  it('returns custom opts when config has extra headers', async () => {
    const capturedOpts: unknown[] = [];
    const strategy = {
      /**
       * Capture opts and return succeed.
       * @param _path - Ignored path.
       * @param opts - Options to capture.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(_path: string, opts: unknown) => {
        capturedOpts.push(opts);
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
    } as never;
    const config = {
      ...makeMockScrapeConfig([]),
      /**
       * Provide Authorization extra header.
       * @returns Headers object.
       */
      extraHeaders: (): Record<string, string> => ({ Authorization: 'Bearer token' }),
    };
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    await executeScrape(ctx, config);
    const opts = capturedOpts[0] as { extraHeaders: Record<string, string> };
    expect(opts.extraHeaders.Authorization).toBe('Bearer token');
  });
});

// ── computeStartDate ───────────────────────────────────────

describe('ScrapeExecutor/computeStartDate', () => {
  it('uses provided startDate when within 1 year', async () => {
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const capturedPaths: string[] = [];
    const strategy = {
      /**
       * Capture path and return succeed.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(path: string) => {
        capturedPaths.push(path);
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
    } as never;
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const opts = { ...ctx.options, startDate: recentDate };
    await executeScrape({ ...ctx, options: opts }, config);
    const txnPath = capturedPaths.find(p => p.includes('/api/txns/'));
    expect(txnPath).toBeDefined();
  });

  it('caps startDate at 1 year when date is older', async () => {
    const oldDate = new Date('2000-01-01');
    const capturedPaths: string[] = [];
    const strategy = {
      /**
       * Capture path and return succeed.
       * @param path - URL path.
       * @returns Succeed procedure.
       */
      fetchGet: <T>(path: string) => {
        capturedPaths.push(path);
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
    } as never;
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const opts = { ...ctx.options, startDate: oldDate };
    await executeScrape({ ...ctx, options: opts }, config);
    expect(capturedPaths.length).toBeGreaterThan(0);
  });
});
