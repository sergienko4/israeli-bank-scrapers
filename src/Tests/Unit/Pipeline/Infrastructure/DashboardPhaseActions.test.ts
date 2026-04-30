/**
 * Unit tests for DashboardPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import {
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
  executeValidateTraffic,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IDashboardState,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithMediator,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/** Pre-resolved target. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'a',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Transactions',
};

describe('executePreLocateNav', () => {
  it('fails when no mediator', async () => {
    const ctx = makeMockContext();
    const result = await executePreLocateNav(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });

  it('fails when no browser', async () => {
    const ctx = makeContextWithMediator();
    const result = await executePreLocateNav(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
  });

  it('fails when no navigation target found', async () => {
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult3);
    const result = await executePreLocateNav(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
  });
});

describe('executeDashboardNavigationSealed', () => {
  it('skips click when traffic already exists', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult5 = makeMockActionExecutor();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTrafficExists: true } },
      makeMockActionExecutorResult5,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('succeeds when no executor', async () => {
    const makeMockContextResult7 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult7, false);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('clicks dashboard target when present', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult9 = makeMockActionExecutor();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      makeMockActionExecutorResult9,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('navigates to dashboardTargetUrl when no click target', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult11 = makeMockActionExecutor();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: { ...base.diagnostics, dashboardTargetUrl: 'https://bank.example.com/txns' },
      },
      makeMockActionExecutorResult11,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('clicks menu target first when present', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult13 = makeMockActionExecutor();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardMenuTarget: MOCK_TARGET } },
      makeMockActionExecutorResult13,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
  });
});

describe('executeValidateTraffic', () => {
  it('fails when no mediator', async () => {
    const ctx = makeMockContext();
    const result = await executeValidateTraffic(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(false);
  });

  it('fails when no traffic captured (primed=false)', async () => {
    const makeScreenshotPageResult16 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult16);
    const result = await executeValidateTraffic(ctx);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(false);
  });
});

describe('executeCollectAndSignal', () => {
  it('fails when dashboard state missing', async () => {
    const ctx = makeMockContext();
    const result = await executeCollectAndSignal(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(false);
  });

  it('succeeds when dashboard state present', async () => {
    const dashState: IDashboardState = {
      isReady: true,
      pageUrl: 'https://bank.example.com/dashboard',
      trafficPrimed: true,
    };
    const ctx = makeMockContext({ dashboard: some(dashState) });
    const result = await executeCollectAndSignal(ctx);
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.finalUrl.has).toBe(true);
    }
  });
});

// ── Extended ACTION coverage — click target + menu + URL stagnation ─

describe('executeDashboardNavigationSealed — deeper paths', () => {
  it('clicks force then natural retry when URL stagnant', async () => {
    const { makeMockActionExecutor: makeExecV2 } = await import('./TestHelpers.js');
    const exec = makeExecV2({
      /**
       * URL never changes.
       * @returns Mock URL.
       */
      getCurrentUrl: () => 'about:blank',
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      { ...base, diagnostics: { ...base.diagnostics, dashboardTarget: MOCK_TARGET } },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(true);
  });

  it('clicks target with apiStrategy=PROXY (no force click)', async () => {
    const { API_STRATEGY: apiStrategyEnum } =
      await import('../../../../Scrapers/Pipeline/Types/PipelineContext.js');
    const base = makeMockContext();
    const makeMockActionExecutorResult21 = makeMockActionExecutor();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardTarget: MOCK_TARGET,
          apiStrategy: apiStrategyEnum.PROXY,
        },
      },
      makeMockActionExecutorResult21,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
  });

  it('both menu target + click target in same run', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult23 = makeMockActionExecutor();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardMenuTarget: MOCK_TARGET,
          dashboardTarget: MOCK_TARGET,
        },
      },
      makeMockActionExecutorResult23,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(true);
  });

  it('passes through when no target at all', async () => {
    const makeMockActionExecutorResult26 = makeMockActionExecutor();
    const makeMockContextResult25 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult25, makeMockActionExecutorResult26);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult27 = isOk(result);
    expect(isOkResult27).toBe(true);
  });
});

// ── Additional branch coverage ────────────────────────────────────
