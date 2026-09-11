/**
 * Unit tests for MatrixLoopStrategy — guard clauses (not-applicable paths).
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  fitsMonthRequestBudget,
  MAX_MONTH_REQUESTS,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/MonthRangeBudget.js';
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
/** Records one recorded fetchPost invocation. */
interface IRecordedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

interface ICountingApi {
  readonly api: IApiFetchContext;
  readonly calls: readonly IRecordedCall[];
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

/** Generic-failure response matching `IProcedureFailure` structurally. */
interface IStubFailure {
  readonly success: false;
  readonly errorType: 'GENERIC';
  readonly errorMessage: string;
  readonly errorDetails: Record<string, never>;
}

/**
 * Single instance of the canonical stub failure — the catalog
 * iteration tests don't inspect the payload; they only count calls.
 */
const STUB_FAILURE: IStubFailure = {
  success: false,
  errorType: 'GENERIC',
  errorMessage: 'stub',
  errorDetails: {},
};

/**
 * Build a recording `fetchPost` that pushes `{url, body}` into
 * `calls` and returns the canonical stub failure. Extracted so
 * {@link makeCountingApi} stays within the 10-line method budget.
 *
 * @param calls - Mutable accumulator owned by the caller.
 * @returns `fetchPost` stub bound to the accumulator.
 */
function makeFetchPostRecorder(
  calls: IRecordedCall[],
): (url: string, body: Record<string, unknown>) => Promise<IStubFailure> {
  return (url, body): Promise<IStubFailure> => {
    calls.push({ url, body });
    return Promise.resolve(STUB_FAILURE);
  };
}

/**
 * Build the inert `fetchGet` stub — required by `IApiFetchContext`
 * but never invoked by the catalog-driven matrix loop.
 *
 * @returns Failure procedure.
 */
function fetchGetStub(): Promise<IStubFailure> {
  return Promise.resolve(STUB_FAILURE);
}

/**
 * Extract the calendar year encoded in an accepted cycle date.
 * Supports both shapes the parser handles — Backbase `MM/YYYY` and
 * ISO `YYYY-MM-DD`. Returns `NaN` on miss; the bounds test only
 * consults this value when `isAccepted` is true so the miss path
 * is unreached during normal runs.
 *
 * @param billingDate - Cycle date string.
 * @returns Parsed year on success; `NaN` otherwise.
 */
function extractAcceptedYear(billingDate: string): number {
  const backbase = /^\d{2}\/(\d{4})$/.exec(billingDate);
  if (backbase !== null) return Number(backbase[1]);
  const iso = /^(\d{4})-\d{2}/.exec(billingDate);
  if (iso !== null) return Number(iso[1]);
  return Number.NaN;
}

/**
 * Build a per-call counting `IApiFetchContext` stub. Each `fetchPost`
 * invocation appends the URL to the `calls` array.
 *
 * @returns Counting api stub.
 */
function makeCountingApi(): ICountingApi {
  const calls: IRecordedCall[] = [];
  const api = {
    fetchPost: makeFetchPostRecorder(calls),
    fetchGet: fetchGetStub,
    transactionsUrl: false as const,
    balanceUrl: false as const,
    pendingUrl: false as const,
  } as unknown as IApiFetchContext;
  return { api, calls };
}

/**
 * Build distinct valid monthly catalog entries.
 * @param count - Number of cycles to generate.
 * @returns Chronological cycle catalog.
 */
function catalogWithCount(count: number): IBillingCycleCatalog {
  const cycles = Array.from({ length: count }, (_, index) => {
    const month = String((index % 12) + 1).padStart(2, '0');
    const year = String(2000 + Math.floor(index / 12));
    return { billingDate: `${month}/${year}`, isOpen: false };
  });
  return { cycles };
}

/**
 * Run an oversized catalog, which must stop before rate-limit timers.
 * @param count - Number of valid catalog entries.
 * @returns Recorded requests and the Matrix result.
 */
async function runCatalogCount(count: number): Promise<{
  readonly calls: readonly IRecordedCall[];
  readonly result: Awaited<ReturnType<typeof tryMatrixLoop>>;
}> {
  const { api, calls } = makeCountingApi();
  const templatePostData = JSON.stringify({ month: 1, year: 2026, accountId: 'a' });
  const txnEndpoint = stubTxn({
    url: 'https://bank.example/api/txn',
    method: 'POST',
    templatePostData,
  });
  const fc = {
    api,
    network: makeInertNetwork(),
    startDate: '20000101',
    txnEndpoint,
    billingCycleCatalog: catalogWithCount(count),
  };
  const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
  return { calls, result };
}

/** Date returned when production tries to re-parse a named month as an instant. */
const WRONG_MONTH_INSTANT = '1999-01-01T00:00:00.000Z';

/**
 * Replace only string-based Date construction while a Matrix probe runs.
 * The correct design carries a named month object and never invokes this path.
 * @param run - Matrix probe.
 * @returns Probe result.
 */
async function withTamperedStringDate<T>(run: () => Promise<T>): Promise<T> {
  const realDate = globalThis.Date;
  /**
   * Delegate every construction except the defective ISO-string round-trip.
   * @param args - Original Date constructor arguments.
   * @returns Real or sentinel Date.
   */
  const tampered = function (...args: unknown[]): Date {
    const [value] = args;
    if (typeof value === 'string' && value.endsWith('Z')) {
      return new realDate(WRONG_MONTH_INSTANT);
    }
    return Reflect.construct(realDate, args) as Date;
  };
  Object.assign(tampered, { now: realDate.now, parse: realDate.parse, UTC: realDate.UTC });
  globalThis.Date = tampered as unknown as DateConstructor;
  try {
    return await run();
  } finally {
    globalThis.Date = realDate;
  }
}

describe('tryMatrixLoop — catalog-driven iteration', () => {
  it('[MATRIX-CATALOG-BUDGET-300] accepts a catalog at the request ceiling', () => {
    const plan = catalogWithCount(MAX_MONTH_REQUESTS).cycles;
    const hasBudget = fitsMonthRequestBudget(plan);
    expect(hasBudget).toBe(true);
  });

  it('[MATRIX-CATALOG-BUDGET-301] rejects a catalog above the request ceiling', async () => {
    const { calls, result } = await runCatalogCount(MAX_MONTH_REQUESTS + 1);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'MatrixLoop: invalid or oversized cycle catalog (limit 300)',
    });
  });

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

  it('asks for the month the catalog names without parsing it as an instant', async () => {
    const catalog: IBillingCycleCatalog = {
      cycles: [{ billingDate: '03/2026', isOpen: true }],
    };
    const { api, calls } = makeCountingApi();
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2020, accountId: 'a' }),
    });
    const fc: IAccountFetchCtx = {
      api,
      network: makeInertNetwork(),
      startDate: '20260101',
      txnEndpoint: ep,
      billingCycleCatalog: catalog,
    };
    /**
     * Execute Matrix under the Date sentinel.
     * @returns Matrix result.
     */
    const runMatrix = (): ReturnType<typeof tryMatrixLoop> =>
      tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    const matrixResult = withTamperedStringDate(runMatrix);
    await matrixResult;
    expect(calls[0].body.month).toBe('3');
    expect(calls[0].body.year).toBe('2026');
  });

  /** One row in the cycle-month bounds truth table. */
  interface IBackbaseBoundsCase {
    readonly billingDate: string;
    readonly isAccepted: boolean;
  }

  const backbaseBoundsCases: readonly IBackbaseBoundsCase[] = [
    { billingDate: '00/2026', isAccepted: false },
    { billingDate: '13/2026', isAccepted: false },
    { billingDate: '01/2026', isAccepted: true },
    { billingDate: '12/2026', isAccepted: true },
    // ISO-shape misses — neither may create an unrelated request.
    { billingDate: 'not-a-date', isAccepted: false },
    { billingDate: '2026-13-01', isAccepted: false },
    // ISO-shape happy path — explicitly fetched year matches the
    // parsed year (timezone-safe regardless of runner locale).
    { billingDate: '2026-07-15', isAccepted: true },
  ];

  describe('with malformed-label rejection', () => {
    it.each(backbaseBoundsCases)(
      '[MATRIX-CATALOG-BOUNDS] BackbaseBillingDate_$billingDate_acceptanceMatchesRange',
      async testCase => {
        const catalog: IBillingCycleCatalog = {
          cycles: [{ billingDate: testCase.billingDate, isOpen: true }],
        };
        const { api, calls } = makeCountingApi();
        const ep = stubTxn({
          url: 'https://bank.example/api/txn',
          method: 'POST',
          templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
        });
        const fc: IAccountFetchCtx = {
          api,
          network: makeInertNetwork(),
          startDate: '20251101',
          txnEndpoint: ep,
          billingCycleCatalog: catalog,
        };
        await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
        const expectedCalls = testCase.isAccepted ? 1 : 0;
        expect(calls).toHaveLength(expectedCalls);
        if (testCase.isAccepted) {
          const [recorded] = calls;
          const fetchedYear = Number(recorded.body.year);
          const acceptedYear = extractAcceptedYear(testCase.billingDate);
          expect(fetchedYear).toBe(acceptedYear);
        }
      },
    );
  });

  it('[MATRIX-CATALOG-INTEGRITY-302] rejects a mixed catalog before fetching', async () => {
    const catalog: IBillingCycleCatalog = {
      cycles: [
        { billingDate: '06/2026', isOpen: true },
        { billingDate: 'not-a-date', isOpen: false },
      ],
    };
    const { api, calls } = makeCountingApi();
    const txnEndpoint = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
    });
    const fc: IAccountFetchCtx = {
      api,
      network: makeInertNetwork(),
      startDate: '20251101',
      txnEndpoint,
      billingCycleCatalog: catalog,
    };
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false });
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

/**
 * Phase F — verifies `tryMatrixLoop` invokes `deduplicateTxns` on the
 * concatenated chunk results so cross-cycle echoes never reach
 * `buildAccountResult`. The bug fixed: Isracard / Amex returned the
 * same pending-approval row in every cycle's response, and matrix-loop
 * concatenated them all into the final account result (8 echoes for
 * card 5290).
 *
 * <p>The fixture: every chunk fetch returns the SAME single-txn body.
 * Without dedup, N chunks → N concatenated copies in the output.
 * With dedup, the result must collapse to one.
 */
describe('tryMatrixLoop — Phase F dedup adoption', () => {
  /** Identifier-bearing single-txn body the stub returns for every chunk. */
  const echoBody = {
    txns: [
      {
        purchaseDate: '2026-04-15T00:00:00',
        businessName: 'echo-merchant',
        originalAmount: 240,
        originalCurrency: 'ILS',
        ilsAmount: 240,
        seqVoucherNumber: 'echo-id-001',
      },
    ],
  };

  /**
   * Stub `fetchPost` that returns the echo body wrapped in the
   * Procedure-success contract for every call.
   *
   * @param calls - Mutable accumulator owned by the test.
   * @returns Recording `fetchPost`.
   */
  function makeEchoFetchPost(calls: IRecordedCall[]): (
    url: string,
    body: Record<string, unknown>,
  ) => Promise<{
    success: true;
    value: Record<string, unknown>;
  }> {
    return (url, body): Promise<{ success: true; value: Record<string, unknown> }> => {
      calls.push({ url, body });
      return Promise.resolve({ success: true, value: echoBody });
    };
  }

  /**
   * Build a counting API whose `fetchPost` returns a successful body
   * (the echo row) on every call. Mirrors {@link makeCountingApi}'s
   * shape but swaps the failure stub for a success one.
   *
   * @returns Counting API + the recording accumulator.
   */
  function makeSuccessCountingApi(): { api: IApiFetchContext; calls: IRecordedCall[] } {
    const calls: IRecordedCall[] = [];
    const api = {
      fetchPost: makeEchoFetchPost(calls),
      fetchGet: fetchGetStub,
      transactionsUrl: false as const,
      balanceUrl: false as const,
      pendingUrl: false as const,
    } as unknown as IApiFetchContext;
    return { api, calls };
  }

  it('[MATRIX-DEDUP-001] CrossCycleEchoes_ShouldCollapseToOne', async () => {
    // 3 cycles → 3 fetchPost calls → 3 identical echo txns concatenated.
    // After dedup (Phase F): result has 1 unique txn.
    const catalog: IBillingCycleCatalog = {
      cycles: [
        { billingDate: '03/2026', isOpen: false },
        { billingDate: '04/2026', isOpen: false },
        { billingDate: '05/2026', isOpen: true },
      ],
    };
    const { api, calls } = makeSuccessCountingApi();
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify({ month: 1, year: 2026, accountId: 'a' }),
    });
    const fc: IAccountFetchCtx = {
      api,
      network: makeInertNetwork(),
      startDate: '20260101',
      txnEndpoint: ep,
      billingCycleCatalog: catalog,
    };

    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });

    expect(result).not.toBe(false);
    if (result !== false && result.success) {
      // Bug fix: 3 echoes collapse to 1 (by identifier or attribute hash).
      expect(result.value.txns.length).toBe(1);
    }
    // Sanity: the strategy still made the 3 expected fetches before
    // dedup ran on the concatenated output.
    expect(calls.length).toBe(3);
  });
});
