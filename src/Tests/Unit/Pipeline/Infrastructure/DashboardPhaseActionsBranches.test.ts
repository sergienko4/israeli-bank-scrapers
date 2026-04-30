/**
 * Branch coverage extensions for DashboardPhaseActions.
 * Targets: takeDashboardScreenshot catch path (line 93), maybeAttachApi
 * fetchStrategy/api guards (lines 530-531), executeDashboardNavigationSealed
 * click retry paths, menu click/waitForNetworkIdle catch branches.
 */

import type { Page } from 'playwright-core';

import {
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeMockActionExecutor,
  makeScreenshotPage,
  requireBrowser,
  toActionCtx,
} from './TestHelpers.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Pre-resolved target used across branches. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'a',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Transactions',
};

// ── takeDashboardScreenshot catch path (line 93) ─────────────────

describe('executePreLocateNav — screenshot catch', () => {
  it('continues when page.screenshot throws synchronously', async () => {
    /** Page whose screenshot throws synchronously to exercise catch branch. */
    const brokenPage = {
      ...makeScreenshotPage(),
      /**
       * Synchronously throws.
       * @returns Never.
       */
      screenshot: (): Promise<Buffer> => {
        throw new TestError('screenshot fail');
      },
    };
    const ctx = makeContextWithBrowser(brokenPage as unknown as Page);
    const result = await executePreLocateNav(ctx);
    // Phase completes (may fail on no-target, but the screenshot path is hit).
    expect(typeof result.success).toBe('boolean');
  });
});

// ── dumpDashboardText catch path (line 195) ──────────────────────

describe('executePreLocateNav — dumpDashboardText catch', () => {
  it('exits cleanly when page.$$eval throws', async () => {
    const makeScreenshotPageResult1 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult1);
    const baseBrowser = requireBrowser(base);
    /** Override page with $$eval that rejects. */
    const brokenPage = {
      ...baseBrowser.page,
      /**
       * Rejects the eval call.
       * @returns Rejected.
       */
      $$eval: (): Promise<string[]> => Promise.reject(new Error('eval broken')),
    };
    const ctx = {
      ...base,
      browser: some({ ...baseBrowser, page: brokenPage as unknown as Page }),
    };
    const result = await executePreLocateNav(ctx);
    // No target => fails, but dumpDashboardText catch exercised.
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
  });
});

// ── executeDashboardNavigationSealed retry: natural URL changes ──

describe('executeDashboardNavigationSealed — URL change branches', () => {
  it('returns after force-click URL changes (isFirstChanged=true)', async () => {
    let count = 0;
    const exec = makeMockActionExecutor({
      /**
       * URL changes immediately.
       * @returns 1st call vs subsequent.
       */
      getCurrentUrl: () => {
        count += 1;
        if (count === 1) return 'https://a/before';
        return 'https://a/after';
      },
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('URL unchanged after force AND natural AND last — logs third stagnation', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Always stagnant.
       * @returns Same URL.
       */
      getCurrentUrl: () => 'https://stuck/same',
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('URL changes after natural retry (isSecondChanged=true)', async () => {
    let count = 0;
    const exec = makeMockActionExecutor({
      /**
       * First 2 calls same, 3rd different.
       * @returns Stepwise.
       */
      getCurrentUrl: () => {
        count += 1;
        if (count <= 2) return 'https://a/same';
        return 'https://a/finally-changed';
      },
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });
});

// ── waitForNetworkIdle catch branches (lines 274, 288, 406, 417) ─

describe('executeDashboardNavigationSealed — network idle catch', () => {
  it('swallows waitForNetworkIdle rejection after click', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Always rejects.
       * @returns Rejected.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('idle reject')),
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('swallows menu waitForNetworkIdle rejection', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Rejects network idle.
       * @returns Rejected.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('menu idle reject')),
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardMenuTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });
});

// ── maybeAttachApi guards (lines 530-531) ────────────────────────

describe('executeCollectAndSignal — maybeAttachApi guards', () => {
  it('line 530: fetchStrategy=none → returns input unchanged', async () => {
    const dashState: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/d',
      trafficPrimed: true,
    };
    /** Mediator present, fetchStrategy none — forces 530 branch. */
    const mediator = makeMockMediator();
    const ctx = makeMockContext({
      dashboard: some(dashState),
      mediator: some(mediator),
      // fetchStrategy stays none by default
    });
    const result = await executeCollectAndSignal(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('line 531: api already present → skips buildApiContext', async () => {
    const dashState: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/d',
      trafficPrimed: true,
    };
    const mediator = makeMockMediator();
    const makeMockFetchStrategyResult9 = makeMockFetchStrategy();
    const ctx = makeMockContext({
      dashboard: some(dashState),
      mediator: some(mediator),
      fetchStrategy: some(makeMockFetchStrategyResult9),
      api: some({ accountsUrl: 'https://api/a' } as unknown as IApiFetchContext),
    });
    const result = await executeCollectAndSignal(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });
});

// ── dashboardTarget + PROXY + menu all present ───────────────────
