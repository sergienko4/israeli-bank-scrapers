/**
 * Regression tests — `tryFirstWave` window-coverage guard (2026-06-07).
 *
 * <p>Pins the fix for the Hapoalim "billing-cycle preview-only" bug:
 * when the captured TXN endpoint URL carries WK date-range params
 * (Hapoalim's
 * `current-account/transactions?retrievalStartDate=…&retrievalEndDate=…`
 * POST) AND the captured window's fromDate is AFTER the user's
 * requested `options.startDate`, the DASHBOARD-side harvest reflects
 * only the SPA's narrow dashboard view — it does NOT cover the user's
 * full requested range. The fast path skips and downstream routing
 * runs the monthly-chunked re-fetch with the user's range patched
 * into the URL.
 *
 * <p>Bug evidence: real Hapoalim run on 2026-06-07 returned 1 txn
 * (~30-day SPA preview) instead of the full ~1-year billing cycle the
 * user requested. Picker correctly selected the POST endpoint; the
 * bug was the unconditional first-wave short-circuit consuming the
 * SPA's narrow harvest.
 *
 * <p>Branches covered:
 * <ul>
 *   <li>Hapoalim shape (URL WK params + captured window NARROWER than
 *     requested) → first-wave SKIPPED → fresh chunked fetches fire.</li>
 *   <li>Backward-compat: URL without WK params + harvest applies →
 *     first-wave still consumes harvest (no fetch).</li>
 *   <li>Boundary: URL WK params + captured window WIDER than
 *     requested → first-wave still consumes harvest (no fetch).</li>
 * </ul>
 */

import { scrapeOneAccountPost } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeStrategy.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountFetchCtx,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type {
  IApiFetchContext,
  IDashboardTxnHarvest,
  ITxnEndpoint,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction, ITransactionsAccount } from '../../../../../../Transactions.js';
import { makeApi, makeFc, makeNetwork, stubFetchPostFail } from '../../StrategyTestHelpers.js';

const HARVEST_RECORD: ITransaction = {
  type: 'normal',
  date: '2026-06-03',
  processedDate: '2026-06-03',
  originalAmount: -123,
  originalCurrency: 'ILS',
  chargedAmount: -123,
  chargedCurrency: 'ILS',
  description: 'HARVEST-RECORD',
  memo: '',
  status: 'completed',
  identifier: 'HARVEST-1',
} as unknown as ITransaction;

const FRESH_RECORD: Record<string, unknown> = {
  date: '2025-08-15',
  amount: -456,
  description: 'FRESH-RECORD',
  identifier: 'FRESH-1',
};

// Hapoalim-shape URL: captured window = 1 month (May 2026 → Jun 2026)
const HAPOALIM_WINDOWED_URL =
  'https://bank.fake.example/api/current-account/transactions' +
  '?numItemsPerPage=150&sortCode=1' +
  '&retrievalStartDate=20260508&retrievalEndDate=20260607' +
  '&accountId=FAKE-ACCT-1';
const NON_WINDOWED_URL = 'https://bank.fake.example/api/txns?accountId=FAKE-ACCT-1';
const WIDE_WINDOWED_URL =
  'https://bank.fake.example/api/current-account/transactions' +
  '?retrievalStartDate=20240101&retrievalEndDate=20260607' +
  '&accountId=FAKE-ACCT-1';
const MALFORMED_WINDOWED_URL =
  'https://bank.fake.example/api/current-account/transactions' +
  '?retrievalStartDate=NOTADATE&retrievalEndDate=BADDATE' +
  '&accountId=FAKE-ACCT-1';

/**
 * Build an empty-body TXN endpoint with the supplied URL. Mirrors
 * Hapoalim's captured shape (POST body `{}` so `isRangeIterable`
 * returns false — only the URL window distinguishes).
 *
 * @param url - Captured txn URL.
 * @returns Slim TXN endpoint suitable for IAccountFetchCtx.
 */
function makeEmptyBodyEndpoint(url: string): ITxnEndpoint {
  return {
    ...EMPTY_TXN_ENDPOINT,
    url,
    method: 'POST',
    templatePostData: '{}',
  };
}

/**
 * Build a single-record harvest for the FAKE-ACCT-1 fixture.
 *
 * @returns IDashboardTxnHarvest carrying {@link HARVEST_RECORD}.
 */
function makeSingleHarvest(): IDashboardTxnHarvest {
  return {
    records: [HARVEST_RECORD],
    capturedAccountId: 'FAKE-ACCT-1',
    multiAccountScope: false,
  };
}

/**
 * Mutable counter for fetchPost — assertions inspect this to confirm
 * whether the strategy short-circuited on harvest or fired fresh
 * fetches.
 */
interface IFetchPostSpy {
  /** Number of recorded fetchPost invocations. */
  count: number;
  /** URLs passed to fetchPost (in invocation order). */
  readonly urls: string[];
}

/**
 * Record one spied fetchPost invocation and return the stub fresh body.
 *
 * @param spy - Mutable spy state to mutate.
 * @param url - URL passed to fetchPost (coerced to string).
 * @returns Promise resolving to a stub success body.
 */
function recordSpyAndReturnFresh(spy: IFetchPostSpy, url: unknown): Promise<Procedure<unknown>> {
  spy.count += 1;
  const urlText = String(url);
  spy.urls.push(urlText);
  const body: Record<string, unknown> = { transactions: [FRESH_RECORD] };
  const result = succeed<unknown>(body);
  return Promise.resolve(result);
}

/**
 * Build a fetchPost stub that records every invocation and returns a
 * stub fresh-fetch body. Wraps assignment to satisfy max-stmts cap.
 *
 * @param spy - Spy object to mutate per invocation.
 * @returns IApiFetchContext['fetchPost'] compatible stub.
 */
function makeSpyingFetchPost(spy: IFetchPostSpy): IApiFetchContext['fetchPost'] {
  const bound = recordSpyAndReturnFresh.bind(null, spy);
  return bound as unknown as IApiFetchContext['fetchPost'];
}

/** Bundled args for {@link makeWindowFc} (keeps the helper under the 3-param cap). */
interface IMakeWindowFcArgs {
  readonly api: IApiFetchContext;
  readonly endpoint: ITxnEndpoint;
  readonly harvest: IDashboardTxnHarvest;
  readonly startDate: string;
}

/**
 * Build a fetch context tying together api + endpoint + harvest +
 * startDate.
 *
 * @param args - Bundled fetch-context inputs.
 * @returns IAccountFetchCtx ready for scrapeOneAccountPost.
 */
function makeWindowFc(args: IMakeWindowFcArgs): IAccountFetchCtx {
  const network = makeNetwork({});
  const fc = makeFc(args.api, network, { startDate: args.startDate });
  return { ...fc, txnEndpoint: args.endpoint, dashboardTxnHarvest: args.harvest };
}

/**
 * Drive scrapeOneAccountPost for one fixture account.
 *
 * @param fc - Pre-built fetch context.
 * @returns Procedure carrying the assembled account.
 */
async function runScrape(fc: IAccountFetchCtx): Promise<Procedure<ITransactionsAccount>> {
  return scrapeOneAccountPost(fc, { accountId: 'FAKE-ACCT-1' });
}

describe('scrapeOneAccountPost — windowed-URL first-wave guard (Hapoalim billing-cycle fix)', () => {
  it('skips first-wave when captured URL window is narrower than requested startDate', async () => {
    // REGRESSION: Hapoalim shape — captured 2026-05-08..2026-06-07 (1 month)
    // but user requested startDate 2025-01-01 (~17 months). Pre-fix the
    // harvest's single record would be returned; post-fix the strategy
    // falls through to scrapePostWithRange which fires monthly chunks.
    const spy: IFetchPostSpy = { count: 0, urls: [] };
    const spyingPost = makeSpyingFetchPost(spy);
    const api = makeApi({ fetchPost: spyingPost });
    const endpoint = makeEmptyBodyEndpoint(HAPOALIM_WINDOWED_URL);
    const harvest = makeSingleHarvest();
    const fc = makeWindowFc({ api, endpoint, harvest, startDate: '20250101' });
    const result = await runScrape(fc);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(spy.count).toBeGreaterThan(1);
    const hasPatched = spy.urls.some((u): boolean => u.includes('retrievalStartDate=2025'));
    expect(hasPatched).toBe(true);
  });

  it('preserves first-wave reuse when captured URL has no WK date-range params', async () => {
    // BACKWARD-COMPAT: harvest fast path is the original Phase 7f
    // optimization; banks whose captured TXN URL carries no WK
    // date-range aliases (e.g. card-family POST with body-only range)
    // must still get the no-fetch short-circuit.
    const failingPost = stubFetchPostFail();
    const api = makeApi({ fetchPost: failingPost });
    const endpoint = makeEmptyBodyEndpoint(NON_WINDOWED_URL);
    const harvest = makeSingleHarvest();
    const fc = makeWindowFc({ api, endpoint, harvest, startDate: '20250101' });
    const result = await runScrape(fc);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.txns.length).toBe(1);
  });

  it('preserves first-wave reuse when captured URL window covers requested startDate', async () => {
    // BOUNDARY: captured window 2024-01-01..2026-06-07; requested
    // startDate 2025-01-01. captured.fromDate <= requested.fromDate so
    // harvest covers the request — short-circuit is still safe.
    const failingPost = stubFetchPostFail();
    const api = makeApi({ fetchPost: failingPost });
    const endpoint = makeEmptyBodyEndpoint(WIDE_WINDOWED_URL);
    const harvest = makeSingleHarvest();
    const fc = makeWindowFc({ api, endpoint, harvest, startDate: '20250101' });
    const result = await runScrape(fc);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.txns.length).toBe(1);
  });

  it('skips first-wave when captured URL has WK keys but malformed date values', async () => {
    // DEFENSIVE BRANCH: URL has WK fromDate+toDate keys but values are
    // un-parseable (neither YYYYMMDD nor ISO). readCapturedFromDate
    // returns false → capturedWindowCoversRequested returns false →
    // first-wave skipped, fresh fetches fire. Pins the safe fallback.
    const spy: IFetchPostSpy = { count: 0, urls: [] };
    const spyingPost = makeSpyingFetchPost(spy);
    const api = makeApi({ fetchPost: spyingPost });
    const endpoint = makeEmptyBodyEndpoint(MALFORMED_WINDOWED_URL);
    const harvest = makeSingleHarvest();
    const fc = makeWindowFc({ api, endpoint, harvest, startDate: '20250101' });
    const result = await runScrape(fc);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(spy.count).toBeGreaterThan(0);
  });
});
