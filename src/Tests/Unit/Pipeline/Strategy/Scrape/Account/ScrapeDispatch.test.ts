/**
 * Unit tests for Strategy/Scrape/Account/ScrapeDispatch — scrapeAllAccounts.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  __BUDGET_SENTINEL,
  __budgetElapsed,
  __dispatchWithTimeout,
  __GLOBAL_SCRAPE_BUDGET_MS,
  __PER_ACCOUNT_TIMEOUT_MS,
  __processOrSkip,
  scrapeAllAccounts,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeDispatch.js';
import type {
  IAccountFetchCtx,
  IFetchAllAccountsCtx,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';
import { makeApi, makeEndpoint, makeNetwork, stubFetchGetOk } from '../../StrategyTestHelpers.js';

/**
 * Build an empty fetch-all ctx that loops over zero accounts.
 * @returns Minimal ctx.
 */
function makeEmptyCtx(): IFetchAllAccountsCtx {
  return {
    fc: {
      api: {} as IFetchAllAccountsCtx['fc']['api'],
      network: {} as IFetchAllAccountsCtx['fc']['network'],
      startDate: '20260101',
    },
    ids: [],
    records: [],
    txnEndpoint: false,
  };
}

/**
 * Build a fetch-all ctx with real api/network stubs.
 * @param overrides - Partial overrides (ids/records/txnEndpoint).
 * @returns Fully populated ctx.
 */
function makeCtx(overrides: Partial<IFetchAllAccountsCtx> = {}): IFetchAllAccountsCtx {
  const api = makeApi({
    fetchGet: stubFetchGetOk({}),
    fetchPost: stubFetchGetOk({}) as IFetchAllAccountsCtx['fc']['api']['fetchPost'],
    transactionsUrl: 'https://example.com/txn',
  });
  const network = makeNetwork({
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverTransactionsEndpoint: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
  });
  const fc: IAccountFetchCtx = { api, network, startDate: '20260101' };
  const base: IFetchAllAccountsCtx = {
    fc,
    ids: ['a1'],
    records: [{ accountId: 'a1' }],
    txnEndpoint: false,
  };
  return { ...base, ...overrides };
}

describe('scrapeAllAccounts', () => {
  it('returns empty array when ids is empty', async () => {
    const ctx = makeEmptyCtx();
    const accounts = await scrapeAllAccounts(ctx);
    expect(accounts).toEqual([]);
  });

  it('routes via URL when txnEndpoint is false (no POST endpoint)', async () => {
    const ctx = makeCtx({ txnEndpoint: false });
    const accounts = await scrapeAllAccounts(ctx);
    const isArrayResult1 = Array.isArray(accounts);
    expect(isArrayResult1).toBe(true);
  });

  it('routes via URL when txnEndpoint.method !== POST (GET case)', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/txn',
      method: 'GET',
      responseBody: {},
    });
    const ctx = makeCtx({ txnEndpoint: ep });
    const accounts = await scrapeAllAccounts(ctx);
    const isArrayResult2 = Array.isArray(accounts);
    expect(isArrayResult2).toBe(true);
  });

  it('routes via URL when accountRecord missing (hasPostEndpoint=false)', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/txn',
      method: 'POST',
      postData: '{}',
      responseBody: {},
    });
    const ctx = makeCtx({
      records: [undefined as unknown as Record<string, unknown>],
      txnEndpoint: ep,
    });
    const accounts = await scrapeAllAccounts(ctx);
    const isArrayResult3 = Array.isArray(accounts);
    expect(isArrayResult3).toBe(true);
  });

  it('routes via POST when txnEndpoint is POST and accountRecord present', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/txn',
      method: 'POST',
      postData: '{"accountId":"a1"}',
      responseBody: {},
    });
    const api = makeApi({
      fetchPost: stubFetchGetOk({}) as IFetchAllAccountsCtx['fc']['api']['fetchPost'],
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const ctx: IFetchAllAccountsCtx = {
      fc: { api, network, startDate: '20260101' },
      ids: ['a1'],
      records: [{ accountId: 'a1' }],
      txnEndpoint: ep,
    };
    const accounts = await scrapeAllAccounts(ctx);
    const isArrayResult4 = Array.isArray(accounts);
    expect(isArrayResult4).toBe(true);
  });

  it('pushes account when result is ok (isOk branch true)', async () => {
    // GET path with success → account pushed to output
    const api = makeApi({
      fetchGet: stubFetchGetOk({}),
      transactionsUrl: 'https://example.com/txn',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: (): false => false,
    });
    const ctx: IFetchAllAccountsCtx = {
      fc: { api, network, startDate: '20260101' },
      ids: ['a1', 'a2'],
      records: [{ accountId: 'a1' }, { accountId: 'a2' }],
      txnEndpoint: false,
    };
    const accounts = await scrapeAllAccounts(ctx);
    expect(accounts.length).toBeGreaterThan(0);
  });
});

describe('ScrapeDispatch per-account timeout helpers', () => {
  it('PER_ACCOUNT_TIMEOUT_MS equals 300_000 (5 minutes)', (): void => {
    expect(__PER_ACCOUNT_TIMEOUT_MS).toBe(300_000);
  });

  it('GLOBAL_SCRAPE_BUDGET_MS equals 600_000 (10 minutes) and exceeds PER_ACCOUNT_TIMEOUT_MS', (): void => {
    expect(__GLOBAL_SCRAPE_BUDGET_MS).toBe(600_000);
    expect(__GLOBAL_SCRAPE_BUDGET_MS).toBeGreaterThan(__PER_ACCOUNT_TIMEOUT_MS);
  });

  it('processOrSkip short-circuits when the deadline has already passed', async (): Promise<void> => {
    // Fetch stub that throws if invoked — the guard must prevent the call.
    const api = makeApi({
      /**
       * Fetch stub that should never be reached.
       * @returns Never called.
       */
      fetchGet: ((): Promise<never> => {
        throw new ScraperError('fetchGet must not be invoked after deadline');
      }) as IAccountFetchCtx['api']['fetchGet'],
      transactionsUrl: 'https://example.com/txn',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns No POST endpoint.
       */
      discoverTransactionsEndpoint: (): false => false,
    });
    const ctx: IFetchAllAccountsCtx = {
      fc: { api, network, startDate: '20260101' },
      ids: ['a1'],
      records: [{ accountId: 'a1' }],
      txnEndpoint: false,
    };
    const out: ITransactionsAccount[] = [];
    const pastDeadline = Date.now() - 1;
    const isOk = await __processOrSkip({ ctx, idx: 0, out, deadline: pastDeadline });
    expect(isOk).toBe(true);
    expect(out).toEqual([]);
    // Budget constants are consistent — guards against accidental regression.
    expect(__GLOBAL_SCRAPE_BUDGET_MS).toBe(600_000);
  });

  it('budgetElapsed resolves to BUDGET_SENTINEL after the supplied delay', async (): Promise<void> => {
    const sentinel = await __budgetElapsed(10);
    expect(sentinel).toBe(__BUDGET_SENTINEL);
    expect(sentinel.exceeded).toBe(true);
  });

  it('BUDGET_SENTINEL is a frozen `{ exceeded: true }` literal', (): void => {
    expect(__BUDGET_SENTINEL).toEqual({ exceeded: true });
  });

  it('dispatchWithTimeout returns a Timeout fail when the budget elapses before work settles', async (): Promise<void> => {
    // A fetchGet impl that never resolves emulates an upstream hang.
    /**
     * Never-resolving fetch stub — exercises the timeout path.
     * @returns A promise that never settles.
     */
    const neverSettles = (): Promise<never> => new Promise((): void => undefined);
    const api = makeApi({
      fetchGet: neverSettles as IAccountFetchCtx['api']['fetchGet'],
      transactionsUrl: 'https://example.com/txn',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns Result.
       */
      discoverTransactionsEndpoint: (): false => false,
    });
    const fc: IAccountFetchCtx = { api, network, startDate: '20260101' };
    const result = await __dispatchWithTimeout({
      fc,
      accountId: 'a1',
      opts: { accountRecord: { accountId: 'a1' }, txnEndpoint: false },
      timeoutMs: 25,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
      expect(result.errorMessage).toContain('per-account');
    }
  });
});
