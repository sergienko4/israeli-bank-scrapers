/**
 * Unit tests for ScrapeExecutor.ts.
 * Covers all fetch paths, error propagation, date computation, empty accounts.
 */

import { jest } from '@jest/globals';
import moment from 'moment-timezone';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { BANK_CALENDAR_TIMEZONE } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import {
  DEFAULT_FETCH_OPTS,
  type IFetchStrategy,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { executeScrape } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeExecutor.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IRawAccount } from '../../../../../Scrapers/Pipeline/Types/ScrapeConfig.js';
import {
  makeMockContext,
  makeMockFetchStrategy,
  makeMockScrapeConfig,
  MOCK_RAW_ACCOUNT,
} from '../MockPipelineFactories.js';

/** URL path for API requests. */
type ApiPath = string;

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
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('No fetchStrategy');
    }
  });

  it('fails before provider work when the requested start is unreadable', async () => {
    const calls: string[] = [];
    const strategy = {
      /**
       * Record a forbidden GET request.
       * @returns Successful placeholder response.
       */
      fetchGet: <T>(): Promise<ReturnType<typeof succeed<T>>> => {
        calls.push('GET');
        const result = succeed({} as T);
        return Promise.resolve(result);
      },
      /**
       * Record a forbidden POST request.
       * @returns Successful placeholder response.
       */
      fetchPost: <T>(): Promise<ReturnType<typeof succeed<T>>> => {
        calls.push('POST');
        const result = succeed({} as T);
        return Promise.resolve(result);
      },
    } as IFetchStrategy;
    const base = MAKE_CTX_WITH_STRATEGY(strategy);
    const options = { ...base.options, startDate: new Date('not-a-date') };
    const config = makeMockScrapeConfig();
    const result = await executeScrape({ ...base, options }, config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('requested start date is unreadable');
    }
    expect(calls).toHaveLength(0);
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
    } as unknown as IFetchStrategy;
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
    } as unknown as IFetchStrategy;
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
        const r = fail(ScraperErrorTypes.Generic, 'accounts failed');
        return Promise.resolve(r);
      },
      /**
       * Return fail for all calls.
       * @returns Fail procedure.
       */
      fetchPost: () => {
        const r = fail(ScraperErrorTypes.Generic, 'accounts failed');
        return Promise.resolve(r);
      },
    } as unknown as IFetchStrategy;
    const config = makeMockScrapeConfig();
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('accounts failed');
  });
});

// ── Sequential fetch ───────────────────────────────────────

describe('ScrapeExecutor/sequential', () => {
  it('returns empty accounts array when account list is empty', async () => {
    const config = makeMockScrapeConfig([]);
    const ctx = MAKE_CTX_WITH_STRATEGY();
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
    if (result.success) {
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
    } as unknown as IFetchStrategy;
    const config = makeMockScrapeConfig(accounts);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
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
          const r = fail(ScraperErrorTypes.Generic, 'txn fetch failed');
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
    } as unknown as IFetchStrategy;
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('txn fetch failed');
    expect(callCount).toBeGreaterThan(0);
  });

  it('populates scrape.accounts with account number, balance, txns', async () => {
    const config = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const ctx = MAKE_CTX_WITH_STRATEGY();
    const result = await executeScrape(ctx, config);
    expect(result.success).toBe(true);
    if (result.success && result.value.scrape.has) {
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
    } as unknown as IFetchStrategy;
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
    } as unknown as IFetchStrategy;
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

/**
 * A fixed instant for the clock these tests share with the executor.
 *
 * `computeStartDate` reads "now" inside `executeScrape()`, and the one-year cap
 * assertion reads it again afterwards. Left on the real clock those are two
 * separate reads, and a run that crosses midnight in the bank's calendar
 * between them computes two different days. Mid-morning, mid-month, mid-year
 * keeps the frozen instant clear of a day, month or year boundary.
 */
const FROZEN_NOW = new Date('2026-06-15T09:00:00Z');

describe('ScrapeExecutor/computeStartDate', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FROZEN_NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses provided startDate when within 1 year', async () => {
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const capturedDates: string[] = [];
    const strategy = makeMockFetchStrategy();
    const base = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const config = {
      ...base,
      transactions: {
        ...base.transactions,
        /**
         * Capture startDate passed by executor.
         * @param acctId - Account ID.
         * @param startDate - Computed start date.
         * @returns Request path and empty postData.
         */
        buildRequest: (
          acctId: string,
          startDate: string,
        ): { path: ApiPath; postData: Record<string, string> } => {
          capturedDates.push(startDate);
          return { path: `/api/txns/${acctId}`, postData: {} };
        },
      },
    };
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const opts = { ...ctx.options, startDate: recentDate };
    await executeScrape({ ...ctx, options: opts }, config);
    const expectedDate = moment(recentDate).tz(BANK_CALENDAR_TIMEZONE).format('YYYYMMDD');
    expect(capturedDates[0]).toBe(expectedDate);
  });

  it('caps startDate at 1 year when date is older', async () => {
    const oldDate = new Date('2000-01-01');
    const capturedDates: string[] = [];
    const strategy = makeMockFetchStrategy();
    const base = makeMockScrapeConfig([MOCK_RAW_ACCOUNT]);
    const config = {
      ...base,
      transactions: {
        ...base.transactions,
        /**
         * Capture startDate passed by executor.
         * @param acctId - Account ID.
         * @param startDate - Computed start date.
         * @returns Request path and empty postData.
         */
        buildRequest: (
          acctId: string,
          startDate: string,
        ): { path: ApiPath; postData: Record<string, string> } => {
          capturedDates.push(startDate);
          return { path: `/api/txns/${acctId}`, postData: {} };
        },
      },
    };
    const ctx = MAKE_CTX_WITH_STRATEGY(strategy);
    const opts = { ...ctx.options, startDate: oldDate };
    await executeScrape({ ...ctx, options: opts }, config);
    const cappedDate = moment(FROZEN_NOW)
      .tz(BANK_CALENDAR_TIMEZONE)
      .subtract(1, 'years')
      .format('YYYYMMDD');
    expect(capturedDates[0]).toBe(cappedDate);
    expect(cappedDate).toBe('20250615');
  });
});
