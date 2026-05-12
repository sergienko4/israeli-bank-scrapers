/**
 * Unit tests for MatrixLoopStrategy — guard clauses (not-applicable paths).
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { tryMatrixLoop } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/MatrixLoopStrategy.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountFetchCtx,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type {
  IApiFetchContext,
  IBillingCycleCatalog,
  ITxnEndpoint,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a stub fetch context with a pre-resolved slim txnEndpoint
 * (Phase 7f: SCRAPE consumes the typed contract plumbed onto fc by
 * SCRAPE.PRE).
 *
 * @param endpoint - Slim TXN endpoint; pass `EMPTY_TXN_ENDPOINT` when
 *   the test wants the no-endpoint default.
 * @returns IAccountFetchCtx.
 */
function makeFc(endpoint: ITxnEndpoint): IAccountFetchCtx {
  const network = {} as unknown as INetworkDiscovery;
  return {
    api: {} as IApiFetchContext,
    network,
    startDate: '20260101',
    txnEndpoint: endpoint,
  };
}

/**
 * Build a slim TXN endpoint stub from a partial override; defaults to
 * EMPTY for fields the test doesn't care about.
 *
 * @param overrides - Partial override fields.
 * @returns Slim TXN endpoint.
 */
function stubTxn(overrides: Partial<ITxnEndpoint>): ITxnEndpoint {
  return { ...EMPTY_TXN_ENDPOINT, ...overrides };
}

describe('tryMatrixLoop', () => {
  it('returns false when no txn endpoint discovered', async () => {
    const fc = makeFc(EMPTY_TXN_ENDPOINT);
    const result = await tryMatrixLoop({
      fc,
      accountId: 'a',
      displayId: '1',
    });
    expect(result).toBe(false);
  });

  it('returns false when txn endpoint has no templatePostData', async () => {
    const ep = stubTxn({ url: 'https://bank.fake/api', method: 'POST', templatePostData: '' });
    const fc = makeFc(ep);
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(result).toBe(false);
  });

  it('returns false when templatePostData is not a monthly endpoint', async () => {
    const ep = stubTxn({
      url: 'https://bank.fake/api',
      method: 'POST',
      templatePostData: '{"foo":"bar"}',
    });
    const fc = makeFc(ep);
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(result).toBe(false);
  });

  it('resolves to a 0-txn account when the monthly endpoint yields no rows', async () => {
    // Include monthly WK keys so isMonthlyEndpoint returns true.
    const body = { month: 1, year: 2026, accountId: 'a' };
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify(body),
    });
    const api = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      fetchPost: (): { success: false; errorType: string; errorMessage: string } => ({
        success: false,
        errorType: 'Generic',
        errorMessage: 'fail',
      }),
    };
    const fc = {
      api,
      network: {
        /**
         * Empty endpoint list — exercises the 0-balance path.
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
        /**
         * No balance URL discoverable.
         * @returns False.
         */
        buildBalanceUrl: (): false => false,
      },
      startDate: '20260101',
      txnEndpoint: ep,
    } as unknown as IAccountFetchCtx;
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    // Matrix applied + iterated → returns Procedure with 0-txn account
    // (do NOT fall through to scrapePostDirect — its un-templated body
    // would echo the captured leading card onto every empty sibling).
    expect(result).not.toBe(false);
    if (result !== false && result.success) {
      expect(result.value.txns.length).toBe(0);
    }
  });
});

/**
 * Counting POST stub — records every URL the matrix loop fetches so
 * tests can assert how many chunks were iterated and which months
 * landed in `fc.api.fetchPost`.
 *
 * <p>Returns a deterministic Procedure-failure for every call (a
 * 0-txn outcome at the catalog driver — what matters for these tests
 * is the CALL COUNT, not the payload).
 */
interface ICountingApi {
  readonly api: IApiFetchContext;
  readonly calls: readonly string[];
}

/**
 * Empty-endpoint network stub used by the catalog-driven tests —
 * matrix loop never consults `getAllEndpoints` on the catalog path,
 * but the field is required by the interface.
 *
 * @returns Empty endpoint list.
 */
function emptyEndpointList(): readonly IDiscoveredEndpoint[] {
  return [];
}

/**
 * Stub balance-url builder — returns false so the catalog tests
 * exercise the no-balance branch in {@link buildAccountResult}.
 *
 * @returns False (no balance URL discovered).
 */
function noBalanceUrl(): false {
  return false;
}

/**
 * Build an inert {@link INetworkDiscovery} stub. Catalog-driven
 * iteration doesn't touch the network discovery surface; this stub
 * exists only to satisfy the interface.
 *
 * @returns Inert network stub.
 */
function makeInertNetwork(): INetworkDiscovery {
  return {
    getAllEndpoints: emptyEndpointList,
    buildBalanceUrl: noBalanceUrl,
  } as unknown as INetworkDiscovery;
}

/**
 * Build a per-call counting `IApiFetchContext` stub. Each `fetchPost`
 * invocation appends the URL to the `calls` array.
 *
 * @returns Counting api stub.
 */
function makeCountingApi(): ICountingApi {
  const calls: string[] = [];
  /**
   * Generic-failure response matching IProcedureFailure structurally.
   *
   * @returns Failure procedure with the empty errorDetails the
   *   interface requires.
   */
  const stubFailure = (): {
    success: false;
    errorType: 'GENERIC';
    errorMessage: string;
    errorDetails: Record<string, never>;
  } => ({ success: false, errorType: 'GENERIC', errorMessage: 'stub', errorDetails: {} });
  const api = {
    /**
     * Records the URL and returns a stub failure.
     * @param url - URL the matrix loop is about to fetch.
     * @returns Failure procedure.
     */
    fetchPost: (url: string): Promise<ReturnType<typeof stubFailure>> => {
      calls.push(url);
      const failure = stubFailure();
      return Promise.resolve(failure);
    },
    /**
     * Unused by matrix-loop; required by the interface contract.
     * @returns Failure procedure.
     */
    fetchGet: (): Promise<ReturnType<typeof stubFailure>> => {
      const failure = stubFailure();
      return Promise.resolve(failure);
    },
    transactionsUrl: false as const,
    balanceUrl: false as const,
    pendingUrl: false as const,
  } as unknown as IApiFetchContext;
  return { api, calls };
}

describe('tryMatrixLoop — catalog-driven iteration', () => {
  it('[MATRIX-CATALOG-USES] WithCatalog_IteratesCatalogCycles_NotMonthChunks', async () => {
    const catalog: IBillingCycleCatalog = {
      cycles: [
        { billingDate: '06/2026', isOpen: true },
        { billingDate: '05/2026', isOpen: false },
      ],
    };
    const { api, calls } = makeCountingApi();
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
    });
    const network = makeInertNetwork();
    const fc: IAccountFetchCtx = {
      api,
      network,
      startDate: '20251101',
      txnEndpoint: ep,
      billingCycleCatalog: catalog,
    };
    await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(calls.length).toBe(catalog.cycles.length);
  });

  it('[MATRIX-CATALOG-FALLBACK] NoCatalog_UsesGenerateMonthChunks', async () => {
    const { api, calls } = makeCountingApi();
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
    });
    const network = makeInertNetwork();
    const fc: IAccountFetchCtx = {
      api,
      network,
      startDate: '20260101',
      txnEndpoint: ep,
    };
    await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    // Default month-chunk plan from 2026-01-01 to now ≥ 1 chunk per
    // month — we don't pin the exact count (date-relative), just
    // that the fallback fired and produced at least one chunk.
    expect(calls.length).toBeGreaterThan(0);
  });

  it('[MATRIX-CATALOG-EMPTY] EmptyCatalog_FallsBackToMonthChunks', async () => {
    const { api, calls } = makeCountingApi();
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
    });
    const network = makeInertNetwork();
    const fc: IAccountFetchCtx = {
      api,
      network,
      startDate: '20260101',
      txnEndpoint: ep,
      billingCycleCatalog: { cycles: [] },
    };
    await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    // Empty catalog → fall back to month chunks → at least 1 call.
    expect(calls.length).toBeGreaterThan(0);
  });
});
