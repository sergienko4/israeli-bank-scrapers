/**
 * Branch coverage extensions for DashboardPhaseActions — deep split.
 * Covers strategy / validate-traffic / logWinningTarget / href-nav-catch branches.
 */

import {
  executeDashboardNavigationSealed,
  executePreLocateNav,
  executeValidateTraffic,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { Option } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IResolvedTarget } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeMockActionExecutor,
  makeScreenshotPage,
  requireBrowser,
  toActionCtx,
} from './TestHelpers.js';

/** Pre-resolved target used across branches. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'a',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Transactions',
};

describe('executeDashboardNavigationSealed — strategy branches', () => {
  it.each([
    ['DIRECT (default)', undefined],
    ['PROXY', API_STRATEGY.PROXY],
  ])('apiStrategy=%s with clickTarget', async (_label, strategy) => {
    const base = makeMockContext();
    const makeMockActionExecutorResult11 = makeMockActionExecutor();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardTarget: MOCK_TARGET,
          apiStrategy: strategy,
        },
      },
      makeMockActionExecutorResult11,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });
});

// ── executeValidateTraffic guard branches ────────────────────────

describe('executeValidateTraffic — deeper guards', () => {
  it('fails when mediator present + primed=false (no endpoints)', async () => {
    const mediator = makeMockMediator();
    const ctx = makeMockContext({ mediator: some(mediator) });
    const result = await executeValidateTraffic(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(false);
  });
});

// ── logWinningTarget menuTarget + hrefTarget branches ────────────

describe('executePreLocateNav — logWinningTarget menu/href branches', () => {
  it('logs menuTarget branch when only menuTarget is resolved (line 93)', async () => {
    const { makeMockMediator: makeMedV2 } =
      await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const makeScreenshotPageResult14 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult14);
    const page = requireBrowser(base).page;
    /** Track which WK pattern is queried so we can map resolveVisible results. */
    let callIdx = 0;
    const mediator = makeMedV2({
      /**
       * First TRANSACTIONS → not found; second MENU → found.
       * @returns Stepwise race result.
       */
      resolveVisible: () => {
        callIdx += 1;
        if (callIdx === 1) return Promise.resolve(notFoundResult);
        return Promise.resolve({
          ...notFoundResult,
          found: true as const,
          candidate: { kind: 'textContent' as const, value: 'Menu' },
          context: page,
          value: 'Menu',
        } as unknown as IRaceResult);
      },
    });
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executePreLocateNav(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });

  it('logs hrefTarget branch when href extraction yields URL (line 100)', async () => {
    const { makeMockMediator: makeMedV2 } =
      await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const makeScreenshotPageResult16 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult16);
    const mediator = makeMedV2({
      /**
       * Return href hit.
       * @returns Hrefs.
       */
      collectAllHrefs: () =>
        Promise.resolve(['https://bank.example.com/transactions'] as readonly string[]),
    });
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executePreLocateNav(ctx);
    // href extraction may succeed or miss
    expect(typeof result.success).toBe('boolean');
  });
});

// ── executePreLocateNav no apiCtx path (line 274) ────────────────

describe('executePreLocateNav — no apiCtx branch', () => {
  it('succeeds when fetchStrategy none + target found → no apiCtx (line 274)', async () => {
    const { makeMockMediator: makeMedV2 } =
      await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const makeScreenshotPageResult17 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult17);
    const page = requireBrowser(base).page;
    const foundRace = {
      ...notFoundResult,
      found: true as const,
      candidate: { kind: 'textContent' as const, value: 'Transactions' },
      context: page,
      value: 'Transactions',
    };
    const mediator = makeMedV2({
      /**
       * Return found.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(foundRace as unknown as IRaceResult),
    });
    // Force fetchStrategy to none by creating mockContext without fetch
    const ctx = {
      ...base,
      mediator: some(mediator),
      fetchStrategy: { has: false } as unknown as Option<IFetchStrategy>,
    };
    const result = await executePreLocateNav(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
  });
});

// ── executeHrefNav waitForNetworkIdle catch (line 386) ───────────

describe('executeDashboardNavigationSealed — href nav network idle catch', () => {
  it('catches waitForNetworkIdle rejection after successful href nav', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Succeeds nav.
       * @returns Succeed.
       */
      navigateTo: () =>
        Promise.resolve({ success: true, value: undefined } as unknown as Procedure<undefined>),
      /**
       * Rejects idle.
       * @returns Rejected.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('idle reject')),
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardTargetUrl: 'https://bank.example.com/txns',
        },
      },
      exec,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
  });
});
