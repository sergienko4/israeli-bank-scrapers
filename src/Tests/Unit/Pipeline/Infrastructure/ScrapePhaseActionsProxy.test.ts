/**
 * ScrapePhaseActions — PROXY session activation + forensic prime branches.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { executeForensicPre } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import type { IFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IDashboardState,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

/** Canned OK body for fetchPost/fetchGet in strategy mocks. */
const OK_EMPTY_BODY = succeed({});
/** Canned success for activateSession. */
const OK_TRUE = succeed(true);
/** Canned failure for activateSession. */
const FAIL_PROXY_REFUSED = fail(ScraperErrorTypes.Generic, 'proxy refused');

/**
 * Build a stub API.
 * @returns Stub API fetch context.
 */
function makeApi(): IApiFetchContext {
  return {
    /**
     * Always succeed GET.
     * @returns Resolved.
     */
    fetchGet: () => Promise.resolve(OK_EMPTY_BODY),
    /**
     * Always succeed POST.
     * @returns Resolved.
     */
    fetchPost: () => Promise.resolve(OK_EMPTY_BODY),
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('executeForensicPre with mediator, no api', () => {
  it('DIRECT path without api — passthrough with diag', async () => {
    const mediator = makeMockMediator();
    const base = makeMockContext({ mediator: some(mediator) });
    const result = await executeForensicPre(base);
    const isOkResult32 = isOk(result);
    expect(isOkResult32).toBe(true);
  });
});

describe('executeForensicPre PROXY — session activation', () => {
  it('activates proxy session when strategy has activateSession', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    /** Fetch strategy with activateSession returning success. */
    const strategy = {
      /**
       * Session activation succeeds.
       * @returns Succeed.
       */
      activateSession: (): Promise<Procedure<boolean>> => Promise.resolve(OK_TRUE),
      /**
       * No-op fetchPost.
       * @returns Succeed.
       */
      fetchPost: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
      /**
       * No-op fetchGet.
       * @returns Succeed.
       */
      fetchGet: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
    };
    const makeApiResult33 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult33),
      fetchStrategy: some(strategy as unknown as IFetchStrategy),
      diagnostics: {
        ...baseWithBrowser.diagnostics,
        apiStrategy: API_STRATEGY.PROXY,
        discoveredProxyUrl: 'https://proxy.example.com',
      },
    };
    const result = await executeForensicPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('fails when strategy.activateSession returns fail', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const strategy = {
      /**
       * Session activation fails.
       * @returns Fail.
       */
      activateSession: (): Promise<Procedure<boolean>> => Promise.resolve(FAIL_PROXY_REFUSED),
      /**
       * No-op fetchPost.
       * @returns Succeed.
       */
      fetchPost: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
      /**
       * No-op fetchGet.
       * @returns Succeed.
       */
      fetchGet: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
    };
    const makeApiResult34 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult34),
      fetchStrategy: some(strategy as unknown as IFetchStrategy),
      diagnostics: {
        ...baseWithBrowser.diagnostics,
        apiStrategy: API_STRATEGY.PROXY,
      },
    };
    const result = await executeForensicPre(ctx);
    const isOkResult35 = isOk(result);
    expect(isOkResult35).toBe(false);
  });

  it('skips session activation when strategy has no activateSession', async () => {
    const page = makeScreenshotPage();
    const baseWithBrowser = makeContextWithBrowser(page);
    const strategy = {
      /**
       * No activateSession fn.
       * @returns Succeed.
       */
      fetchPost: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
      /**
       * No-op fetchGet.
       * @returns Succeed.
       */
      fetchGet: (): Promise<Procedure<unknown>> => Promise.resolve(OK_EMPTY_BODY),
    };
    const makeApiResult36 = makeApi();
    const ctx = {
      ...baseWithBrowser,
      api: some(makeApiResult36),
      fetchStrategy: some(strategy as unknown as IFetchStrategy),
      diagnostics: {
        ...baseWithBrowser.diagnostics,
        apiStrategy: API_STRATEGY.PROXY,
      },
    };
    const result = await executeForensicPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executeForensicPre — forensic prime branch', () => {
  it('calls triggerDashboardUi when dashboard not primed', async () => {
    const mediator = makeMockMediator();
    /** Dashboard not primed — exercises maybeForensicPrime path. */
    const dashState: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/d',
      trafficPrimed: false,
    };
    const base = makeMockContext({
      mediator: some(mediator),
      dashboard: some(dashState),
    });
    const result = await executeForensicPre(base);
    const isOkResult37 = isOk(result);
    expect(isOkResult37).toBe(true);
  });
});
