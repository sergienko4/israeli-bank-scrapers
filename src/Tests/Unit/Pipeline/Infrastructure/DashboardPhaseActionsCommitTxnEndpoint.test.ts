/**
 * Phase 7e — DASHBOARD.FINAL `commitTxnEndpoint` fail-loud paths.
 *
 * <p>Production contract: DASHBOARD.FINAL either commits a complete
 * `ctx.txnEndpoint` (URL + fieldMap with date AND amount aliases) or
 * halts the pipeline before SCRAPE starts. Two distinct fail-loud
 * paths land users at the same canonical SCRAPE-prevention boundary:
 * <ul>
 *   <li>F-DASH-1 — post-nav pool exposes no WK-txn match within the
 *       FINAL wait budget.</li>
 *   <li>F-DASH-2 — picker returned a URL whose body has no
 *       date/amount-alias-bearing record (Discount-class
 *       zero-records body, malformed BFF response).</li>
 * </ul>
 *
 * <p>This driver pins the messages and the boundary so any drift in
 * the DASHBOARD-side gate surfaces here, not at next live E2E.
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { executeCollectAndSignal } from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IDashboardState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockContext,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';

const DASH_STATE: IDashboardState = {
  isReady: true,
  pageUrl: 'https://bank.fake.example/dashboard',
  trafficPrimed: true,
};

/**
 * Replace the mediator's network surface with field overrides without
 * losing the rest of the default mock implementation. Used to tunnel
 * single-method overrides (discoverTransactionsEndpoint, getPostNavCaptures,
 * waitForTransactionsTraffic) into one mediator.
 *
 * @param networkOverrides - Per-method overrides for the mock network.
 * @returns Mediator with the patched network.
 */
function makeMediatorWithNetwork(networkOverrides: Record<string, unknown>): IElementMediator {
  const base = makeMockMediator();
  const patchedNetwork = { ...base.network, ...networkOverrides };
  return { ...base, network: patchedNetwork };
}

/**
 * Build a fully-populated context for `executeCollectAndSignal` —
 * extracted so the nested `some(makeMockFetchStrategy())` chain stays
 * out of every test body.
 *
 * @param mediator - Mediator surface to inject.
 * @returns Pipeline context ready for the action under test.
 */
function makeReadyCtx(mediator: IElementMediator): ReturnType<typeof makeMockContext> {
  const fetchStrategy = makeMockFetchStrategy();
  const fsOpt = some(fetchStrategy);
  const dashOpt = some(DASH_STATE);
  const medOpt = some(mediator);
  return makeMockContext({
    dashboard: dashOpt,
    mediator: medOpt,
    fetchStrategy: fsOpt,
  });
}

describe('DASHBOARD.FINAL — commitTxnEndpoint fail-loud (Phase 7e contract)', () => {
  it('F-DASH-2: fails loud with DASHBOARD_TXN_FIELDMAP_INCOMPLETE when resolveTxnEndpoint returns false', async () => {
    const mediator = makeMediatorWithNetwork({
      /**
       * Override returns no usable txn endpoint — drives F-DASH-2.
       *
       * @returns false (always, in this test path).
       */
      discoverTransactionsEndpoint: (): false => false,
    });
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOkResult) {
      expect(result.errorMessage).toContain('DASHBOARD_TXN_FIELDMAP_INCOMPLETE');
    }
  });

  it("F-DASH-2 dormant: commits empty endpoint when pool carries dormant-account evidence (Phase H'')", async () => {
    // Phase H'' (2026-05-15): Hapoalim home-page/composite/myAccount
    // body for a dormant account — empty WK txnContainers array +
    // WK fromDate/toDate aliases at nested depth. resolveTxnEndpoint
    // still returns false (no WK-txn URL), but the dormant-evidence
    // detector flips the branch to commit-empty per spec.txt:162.
    const dormantBody = {
      homePageTiltes: [
        {
          data: {
            retrievalTransactionData: {
              retrievalStartDate: 0,
              retrievalEndDate: 0,
            },
            transactions: [],
          },
        },
      ],
    };
    const dormantCapture = {
      url: 'https://bank.fake.example/ServerServices/general/home-page/composite/myAccount',
      method: 'GET' as const,
      postData: '',
      status: 200,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      responseBody: dormantBody,
      timestamp: 1,
    };
    const mediator = makeMediatorWithNetwork({
      /**
       * Picker returns false — no WK-txn URL in the pool.
       *
       * @returns false (always).
       */
      discoverTransactionsEndpoint: (): false => false,
      /**
       * Pool exposes the dormant-evidence capture so the
       * detector flips the branch from fail-loud to commit-empty.
       *
       * @returns Single dormant capture.
       */
      getAllEndpoints: (): readonly [typeof dormantCapture] => [dormantCapture],
    });
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('F-DASH-1: fails loud with DASHBOARD_TXN_ENDPOINT_MISSING when post-nav pool has no WK-txn match and wait expires', async () => {
    const mediator = makeMediatorWithNetwork({
      /**
       * Empty post-nav pool drives the wait gate.
       *
       * @returns Empty captures array.
       */
      getPostNavCaptures: (): readonly [] => [],
      /**
       * Wait budget expires without a match.
       *
       * @returns Resolved false.
       */
      waitForTransactionsTraffic: (): Promise<false> => Promise.resolve(false),
    });
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOkResult) {
      expect(result.errorMessage).toContain('DASHBOARD_TXN_ENDPOINT_MISSING');
    }
  });

  it('passes through when post-nav already has a WK-txn match (no wait needed)', async () => {
    // Default mock has a synthetic txn endpoint pre-staged in
    // getPostNavCaptures + discoverTransactionsEndpoint, so the gate
    // should pass and SCRAPE be signalled.
    const mediator = makeMockMediator();
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('passes when post-nav match arrives during the wait budget', async () => {
    // Initially empty, but the wait promise resolves true → match landed.
    const mediator = makeMediatorWithNetwork({
      /**
       * Empty pool → wait gate exercised.
       *
       * @returns Empty captures array.
       */
      getPostNavCaptures: (): readonly [] => [],
      /**
       * Match lands within budget.
       *
       * @returns Resolved true.
       */
      waitForTransactionsTraffic: (): Promise<true> => Promise.resolve(true),
    });
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('handles waitForTransactionsTraffic rejection by treating it as no-match', async () => {
    const mediator = makeMediatorWithNetwork({
      /**
       * Empty pool → wait gate exercised.
       *
       * @returns Empty captures array.
       */
      getPostNavCaptures: (): readonly [] => [],
      /**
       * Wait promise rejects — gate must catch and treat as no-match.
       *
       * @returns Promise rejecting with a synthetic ScraperError.
       */
      waitForTransactionsTraffic: (): Promise<never> =>
        Promise.reject(new ScraperError('synthetic-network-down')),
    });
    const ctx = makeReadyCtx(mediator);
    const result = await executeCollectAndSignal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOkResult) {
      expect(result.errorMessage).toContain('DASHBOARD_TXN_ENDPOINT_MISSING');
    }
  });
});
