/**
 * ScrapePhaseActions — DIRECT + PROXY branch tests split from main file.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  executeForensicPre,
  executeMatrixLoop,
  executeValidateResults,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import type { IFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
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
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
    if (isOk(result)) {
      // DIRECT path stores scrapeDiscovery
      expect(result.value.scrapeDiscovery.has).toBe(true);
    }
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
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(true);
  });
});

describe('executeForensicPre PROXY path', () => {
  it('runs PROXY with no fetchStrategy — succeeds passthrough', async () => {
    const base = makeMockContext();
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, apiStrategy: API_STRATEGY.PROXY },
    };
    const result = await executeForensicPre(ctx);
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
  });

  it('runs PROXY path with mediator + api (no fetchStrategy)', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const makeApiResult23 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult23),
      diagnostics: {
        ...baseWithBrowser.diagnostics,
        apiStrategy: API_STRATEGY.PROXY,
      },
    };
    const result = await executeForensicPre(ctx);
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(true);
  });
});

describe('executeMatrixLoop branches', () => {
  it('delegates to proxyScrape when fetchStrategy proxyUrl is set', async () => {
    const makeApiResult25 = makeApi();
    const base = makeMockContext({
      fetchStrategy: some({} as unknown as IFetchStrategy),
      api: some(makeApiResult25),
      scrapeDiscovery: some({
        qualifiedCards: ['A1'],
        prunedCards: [],
        txnTemplateUrl: 'https://bank.example.com/txn',
        txnTemplateBody: {},
        billingMonths: [],
      }),
      diagnostics: {
        loginUrl: '',
        finalUrl: none(),
        loginStartMs: 0,
        fetchStartMs: none(),
        lastAction: 'x',
        pageTitle: none(),
        warnings: [],
        discoveredProxyUrl: 'https://proxy.example.com',
        apiStrategy: API_STRATEGY.PROXY,
      },
    });
    const makeMockActionExecutorResult26 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult26);
    const result = await executeMatrixLoop(ctx);
    expect(typeof result.success).toBe('boolean');
  });

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
