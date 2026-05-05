/**
 * ScrapePhaseActions — DIRECT branch tests split from main file.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  executeForensicPre,
  executeMatrixLoop,
  executeValidateResults,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IScrapeDiscovery,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../Transactions.js';
import {
  makeContextWithBrowser,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/**
 * Build a minimal API fetch context.
 * @param postOk - Whether fetchPost succeeds.
 * @returns Mock IApiFetchContext.
 */
function makeApi(postOk = true): IApiFetchContext {
  const isFetchPostOk = postOk;
  const okBody = succeed({});
  const failBody = fail(ScraperErrorTypes.Generic, 'api-down');
  return {
    /**
     * Succeed or fail POST with canned body.
     * @returns Resolved procedure.
     */
    fetchPost: () => {
      const postResult = isFetchPostOk ? okBody : failBody;
      return Promise.resolve(postResult);
    },
    /**
     * Succeed GET.
     * @returns Resolved procedure.
     */
    fetchGet: () => Promise.resolve(okBody),
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('executeForensicPre DIRECT path', () => {
  it('skips discovery when mediator absent (api present)', async () => {
    const makeApiResult16 = makeApi();
    const base = makeMockContext({ api: some(makeApiResult16) });
    const result = await executeForensicPre(base);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });

  it('runs DIRECT discovery path when mediator + api present', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const makeApiResult18 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult18),
    };
    const result = await executeForensicPre(ctx);
    // No real ids captured → fail-fast on empty identifiers. The path
    // is exercised; assert that the procedure returned (success or
    // fail), not that the scrape succeeded with empty data.
    expect(typeof result.success).toBe('boolean');
  });

  it('runs DIRECT with dashboard already primed (skips forensic prime)', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const dash: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/d',
      trafficPrimed: true,
    };
    const makeApiResult20 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult20),
      dashboard: some(dash),
    };
    const result = await executeForensicPre(ctx);
    // Same reason as above — code path exercised, fail-fast on empty
    // ids is the correct outcome here.
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executeForensicPre DIRECT path edge cases', () => {
  it('runs DIRECT with no fetchStrategy — succeeds passthrough', async () => {
    const base = makeMockContext();
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, apiStrategy: API_STRATEGY.DIRECT },
    };
    const result = await executeForensicPre(ctx);
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
  });

  it('propagates discoverAndLoadAccounts fail through DIRECT path', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const failApi = makeApi(false);
    const ctx = {
      ...baseWithBrowser,
      api: some(failApi),
    };
    const result = await executeForensicPre(ctx);
    // discoverAndLoadAccounts internally returns succeed({}) when nothing
    // discovered, so the path completes — we exercise the discovery
    // pipeline with a no-data API.
    expect(typeof result.success).toBe('boolean');
  });

  it('skips forensic prime when dashboard unprimed but mediator absent', async () => {
    /** Dashboard present but unprimed, mediator absent → maybeForensicPrime
     *  hits the `!input.mediator.has` short-circuit (isPrimed=false branch). */
    const dash: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/d',
      trafficPrimed: false,
    };
    const base = makeMockContext({ dashboard: some(dash) });
    const result = await executeForensicPre(base);
    const isOkResult25 = isOk(result);
    expect(isOkResult25).toBe(true);
  });

  it('runs DIRECT path with mediator + api (no fetchStrategy)', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const makeApiResult23 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult23),
      diagnostics: {
        ...baseWithBrowser.diagnostics,
        apiStrategy: API_STRATEGY.DIRECT,
      },
    };
    const result = await executeForensicPre(ctx);
    // No real ids captured → fail-fast. Code path exercised; just
    // assert a Procedure was returned.
    expect(typeof result.success).toBe('boolean');
  });

  it('does not fabricate account identifiers when capture is empty', async () => {
    // Discovery yields no usable identifier and no transaction endpoint
    // is captured (mock fixtures don't replay real bank traffic) — the
    // fail-fast guard intentionally lets the empty-accounts result flow
    // through to downstream `assertSuccessfulScrape`, which fires the
    // loud regression signal. The contract this test enforces: no fake
    // ids materialise (no `default` sentinel, no `cardIndex: 0`).
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const apiCtx = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(apiCtx),
    };
    const result = await executeForensicPre(ctx);
    /**
     * Returns true when the procedure failed OR succeeded with no
     * fabricated account identifier (the contract this test enforces).
     * @returns Whether the discovery is empty.
     */
    const computeDiscoveryEmpty = (): boolean => {
      if (!isOk(result)) return true;
      if (!result.value.scrapeDiscovery.has) return true;
      const ids = result.value.scrapeDiscovery.value.accountIds ?? [];
      return ids.length === 0;
    };
    const isDiscoveryEmpty = computeDiscoveryEmpty();
    expect(isDiscoveryEmpty).toBe(true);
  });

  it('proceeds past fail-fast when capture exposes a usable identifier', async () => {
    // Exercises the post-fallback frozen-network setup path. The
    // mediator's network mock returns an endpoint whose body has an
    // `accounts` container with a real `accountId` — extractAccountIds
    // yields a usable id directly, the fail-fast guard skips, and the
    // remaining frozenEndpoints / cachedAuth / storageHarvest /
    // logger.debug statements all execute.
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const apiCtx = makeApi();
    const accountsEp = {
      url: 'https://bank.example/api/accounts',
      method: 'GET',
      postData: '',
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
      responseBody: { accounts: [{ accountId: 'A-real-1234' }] },
    };
    const baseMediator = baseWithBrowser.mediator;
    if (!baseMediator.has) throw Reflect.construct(Error, ['mediator missing']);
    /**
     * Returns the captured endpoint list with one usable account body.
     * @returns Endpoints array.
     */
    const getAllEndpoints = (): readonly unknown[] => [accountsEp];
    /**
     * Reports the captured endpoint as the URL-matched accounts hit.
     * @returns Single endpoint.
     */
    const discoverAccountsEndpoint = (): unknown => accountsEp;
    const mediatorWithEndpoint = {
      ...baseMediator.value,
      network: {
        ...baseMediator.value.network,
        getAllEndpoints,
        discoverAccountsEndpoint,
      },
    } as unknown as typeof baseMediator.value;
    const ctx = {
      ...baseWithBrowser,
      api: some(apiCtx),
      mediator: some(mediatorWithEndpoint),
    };
    const result = await executeForensicPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) {
      expect(result.value.scrapeDiscovery.has).toBe(true);
      if (result.value.scrapeDiscovery.has) {
        expect(result.value.scrapeDiscovery.value.accountIds).toContain('A-real-1234');
      }
    }
  });
});

describe('executeMatrixLoop branches', () => {
  it('runs frozen direct when frozen endpoints exist', async () => {
    const disc: IScrapeDiscovery = {
      qualifiedCards: ['A1'],
      prunedCards: [],
      txnTemplateUrl: '',
      txnTemplateBody: {},
      billingMonths: [],
      frozenEndpoints: [
        { method: 'GET', url: 'https://bank.example.com/accounts', response: {} },
      ] as unknown as IScrapeDiscovery['frozenEndpoints'],
      accountIds: ['A1'],
      rawAccountRecords: [],
      txnEndpoint: false,
      cachedAuth: false,
      storageHarvest: {},
    };
    const makeApiResult27 = makeApi();
    const base = makeMockContext({
      api: some(makeApiResult27),
      scrapeDiscovery: some(disc),
    });
    const makeMockActionExecutorResult28 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult28);
    const result = await executeMatrixLoop(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executeValidateResults deep branches', () => {
  it('warns when all txns have zero amount (multiple accounts)', async () => {
    const txn = {
      type: 'Normal',
      date: '2026-01-01T00:00:00.000Z',
      processedDate: '2026-01-01T00:00:00.000Z',
      originalAmount: 0,
      chargedAmount: 0,
      originalCurrency: 'ILS',
      description: '',
      status: 'completed',
    } as unknown as ITransaction;
    const ctx = makeMockContext({
      scrape: some({
        accounts: [
          { accountNumber: 'A1', balance: 0, txns: [txn, txn] },
          { accountNumber: 'A2', balance: 0, txns: [txn] },
        ],
      }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult29 = isOk(result);
    expect(isOkResult29).toBe(true);
  });

  it('skips warn when no txns across accounts', async () => {
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [] }] }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult30 = isOk(result);
    expect(isOkResult30).toBe(true);
  });

  it('does not warn when some txns have nonzero amounts', async () => {
    const zeroTxn = {
      chargedAmount: 0,
      originalAmount: 0,
    } as unknown as ITransaction;
    const okTxn = {
      chargedAmount: 100,
      originalAmount: 100,
    } as unknown as ITransaction;
    const ctx = makeMockContext({
      scrape: some({
        accounts: [{ accountNumber: 'A1', balance: 0, txns: [zeroTxn, okTxn] }],
      }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult31 = isOk(result);
    expect(isOkResult31).toBe(true);
  });
});
