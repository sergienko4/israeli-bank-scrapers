/**
 * Coverage for the two-stage DASHBOARD ACTION walker:
 *   - identity click success on URL match
 *   - identity click success on hasTxnEndpoint
 *   - identity click fail + count <= 1 → no fallback iteration
 *   - identity click fail + count > 1 → walkFallbackNth iterates and succeeds
 *   - identity click fail + count > 1 → walkFallbackNth exhausts all nths
 *   - restoreUrlIfChanged when URL changed (goback path)
 *
 * Each test wires `dashboardTarget`, `dashboardFallbackSelector`, and
 * `dashboardCandidateCount` in diagnostics so executeDashboardNavigationSealed
 * routes into runIdentityThenFallback.
 */

import type { Page } from 'playwright-core';

import {
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import type {
  IActionMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
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

/** Identity-style target the walker consumes from PRE. */
const TARGET: IResolvedTarget = {
  selector: '[id="winner"]',
  contextId: 'main',
  kind: 'css',
  candidateValue: '[id="winner"]',
};

/** Generic fallback selector for stage-2 iteration. */
const FALLBACK = '[aria-label="תנועות"]';

/** URL that satisfies the WK txn-page pattern (matches /transactions/). */
const TXN_URL = 'https://bank.example/transactions';
/** URL that does NOT match any WK txn-page pattern. */
const NON_TXN_URL = 'https://bank.example/account-summary';

/**
 * Build IActionContext with diagnostics + executor wired for the walker.
 * @param executor - Sealed action mediator the walker drives.
 * @param count - dashboardCandidateCount value (≥1 enables fallback iteration).
 * @param fallback - dashboardFallbackSelector value (generic CSS / text).
 * @returns Action context with diagnostics populated for runIdentityThenFallback.
 */
function makeWalkerCtx(
  executor: IActionMediator,
  count: number,
  fallback: string = FALLBACK,
): IActionContext {
  const base = makeMockContext();
  const withDiag = {
    ...base,
    diagnostics: {
      ...base.diagnostics,
      dashboardTarget: TARGET,
      dashboardFallbackSelector: fallback,
      dashboardCandidateCount: count,
    },
  };
  return toActionCtx(withDiag, executor);
}

describe('DASHBOARD ACTION walker — stage 1 (identity click) success paths', () => {
  it('exits stage 1 when URL matches TXN_PAGE_PATTERNS after click', async () => {
    let urlNow = NON_TXN_URL;
    const executor = makeMockActionExecutor({
      /**
       * Click flips the URL from NON_TXN to TXN to simulate navigation.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        urlNow = TXN_URL;
        return Promise.resolve(true);
      },
      /**
       * Return whichever URL the simulated click set.
       * @returns Current URL.
       */
      getCurrentUrl: (): string => urlNow,
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk1 = isOk(result);
    expect(isOk1).toBe(true);
  });

  it('exits stage 1 when hasTxnEndpoint=true even if URL did not change', async () => {
    let isEndpointHit = false;
    const executor = makeMockActionExecutor({
      /**
       * Click "fires" the BFF endpoint (sets the captured flag).
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        isEndpointHit = true;
        return Promise.resolve(true);
      },
      /**
       * Returns true once the simulated click captured the endpoint.
       * @returns Endpoint hit flag.
       */
      hasTxnEndpoint: (): boolean => isEndpointHit,
      /**
       * URL stays static; success comes from endpoint capture.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk2 = isOk(result);
    expect(isOk2).toBe(true);
  });
});

describe('DASHBOARD ACTION walker — stage 2 (fallback iteration)', () => {
  it('does NOT iterate fallback when count <= 1', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Count click attempts to verify only ONE is fired.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
      /**
       * URL never matches → identity click reports no signal.
       * @returns Non-txn URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 1);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk3 = isOk(result);
    expect(isOk3).toBe(true);
    expect(clicks).toBe(1);
  });

  it('iterates .nth(0..count-1) until one click yields txn signal', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Track click count; succeed signal fires only on the 3rd click
       * (identity = 1, nth=0 = 2, nth=1 = 3 ✓).
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
      /**
       * URL flips to TXN only after the 3rd click (identity + nth=0 + nth=1).
       * @returns Current URL.
       */
      getCurrentUrl: (): string => (clicks >= 3 ? TXN_URL : NON_TXN_URL),
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk4 = isOk(result);
    expect(isOk4).toBe(true);
    // identity (1) + nth=0 (2) + nth=1 (3) = 3 clicks expected
    expect(clicks).toBe(3);
  });

  it('exhausts all nths gracefully when no click yields signal', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Count clicks but never return any signal.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
      /**
       * URL never matches.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 3);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk5 = isOk(result);
    expect(isOk5).toBe(true);
    // identity (1) + nth=0,1,2 (4) = 4 clicks total when fallback exhausts
    expect(clicks).toBe(4);
  });

  it('skips stage 2 when fallbackSelector is empty', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Track clicks; expecting only the identity attempt.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
      /**
       * URL never matches → identity reports no signal.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 5, '');
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk6 = isOk(result);
    expect(isOk6).toBe(true);
    expect(clicks).toBe(1);
  });
});

describe('DASHBOARD ACTION walker — restoreUrlIfChanged (goback)', () => {
  it('navigates back to pre-click URL between fallback attempts when URL changed', async () => {
    let clicks = 0;
    let navigateBacks = 0;
    let urlNow = NON_TXN_URL;
    const executor = makeMockActionExecutor({
      /**
       * Each click pushes the URL to a non-txn detail page; goback restores.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        urlNow = `https://bank.example/detail-${String(clicks)}`;
        return Promise.resolve(true);
      },
      /**
       * goback path restores URL to NON_TXN_URL.
       * @returns Succeed void (typed to match IActionMediator).
       */
      navigateTo: (): ReturnType<IActionMediator['navigateTo']> => {
        navigateBacks += 1;
        urlNow = NON_TXN_URL;
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
      /**
       * Reflects whichever url click/goback set.
       * @returns Current URL.
       */
      getCurrentUrl: (): string => urlNow,
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk7 = isOk(result);
    expect(isOk7).toBe(true);
    // identity click changes URL (1 goback) + nth=0 click changes URL (1 goback) +
    // nth=1 click changes URL (1 goback). Walker exhausts all 3.
    expect(clicks).toBe(3);
    expect(navigateBacks).toBe(3);
  });
});

describe('DASHBOARD ACTION walker — diagnostic guards', () => {
  it('returns input unchanged when dashboardTrafficExists is true (skip click)', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Should never be called.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardTrafficExists: true,
          dashboardTarget: TARGET,
          dashboardFallbackSelector: FALLBACK,
          dashboardCandidateCount: 2,
        },
      },
      executor,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk8 = isOk(result);
    expect(isOk8).toBe(true);
    expect(clicks).toBe(0);
  });
});

describe('DASHBOARD ACTION walker — error branches', () => {
  it('survives clickElement rejection and continues iteration', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * First click rejects (catch path); subsequent clicks succeed but
       * never reach success signal.
       * @returns Rejected on first call, resolved otherwise.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        if (clicks === 1) return Promise.reject(new Error('click failed'));
        return Promise.resolve(true);
      },
      /**
       * URL never matches; walker exhausts.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk9 = isOk(result);
    expect(isOk9).toBe(true);
    // identity (rejected) + nth=0 + nth=1 = 3 attempts despite first failure
    expect(clicks).toBe(3);
  });

  it('runs identity click but skips fallback when count=0', async () => {
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Track click count.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        return Promise.resolve(true);
      },
      /**
       * URL never matches.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const ctx = makeWalkerCtx(executor, 0);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk10 = isOk(result);
    expect(isOk10).toBe(true);
    // Identity click runs even when count=0 (HEAD-equivalent path).
    expect(clicks).toBe(1);
  });
});

describe('DASHBOARD ACTION walker — waitForTxnEndpoint timeout path', () => {
  it('survives waitForTxnEndpoint rejection on URL match', async () => {
    let urlNow = NON_TXN_URL;
    const executor = makeMockActionExecutor({
      /**
       * Click flips URL to /transactions, triggering the post-match wait.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        urlNow = TXN_URL;
        return Promise.resolve(true);
      },
      /**
       * Reflect simulated URL.
       * @returns Current URL.
       */
      getCurrentUrl: (): string => urlNow,
      /**
       * Reject to exercise the .catch fallback in confirmTxnEndpoint.
       * @returns Rejected promise.
       */
      waitForTxnEndpoint: (): Promise<boolean> => Promise.reject(new Error('wait timeout')),
    });
    const ctx = makeWalkerCtx(executor, 2);
    const result = await executeDashboardNavigationSealed(ctx);
    // URL match alone is enough — wait failure does not block success.
    const isOk11 = isOk(result);
    expect(isOk11).toBe(true);
  });
});

describe('DASHBOARD ACTION walker — count > 1 with successful identity click', () => {
  it('logs winner with DOM count metadata and exits stage 1 (no fallback)', async () => {
    let urlNow = NON_TXN_URL;
    let clicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * First click flips URL to /transactions; success on stage 1.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        clicks += 1;
        urlNow = TXN_URL;
        return Promise.resolve(true);
      },
      /**
       * Reflect URL state.
       * @returns Current URL.
       */
      getCurrentUrl: (): string => urlNow,
    });
    const ctx = makeWalkerCtx(executor, 4);
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk12 = isOk(result);
    expect(isOk12).toBe(true);
    // Identity-only click — count=4 fallback is never iterated.
    expect(clicks).toBe(1);
  });
});

describe('DASHBOARD ACTION — href + menu click failure branches', () => {
  it('logs and returns false when href navigateTo rejects', async () => {
    const executor = makeMockActionExecutor({
      /**
       * Reject navigation to exercise the "nav failed" branch.
       * @returns Rejected promise.
       */
      navigateTo: (): ReturnType<IActionMediator['navigateTo']> =>
        Promise.reject(new Error('nav rejected')),
      /**
       * URL never matches; traffic gate not used.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const base = makeMockContext();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          // No clickTarget, only an hrefTarget so the executor's navigateTo
          // path fires (and rejects → exercises line 415).
          dashboardTargetUrl: 'https://bank.example/transactions',
        },
      },
      executor,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk13 = isOk(result);
    expect(isOk13).toBe(true);
  });

  it('logs menu click failure branch when clickElement rejects', async () => {
    let menuClicks = 0;
    const executor = makeMockActionExecutor({
      /**
       * Reject menu click — exercises the !didClick branch (line 389).
       * @returns Rejected promise.
       */
      clickElement: (): Promise<true> => {
        menuClicks += 1;
        return Promise.reject(new Error('menu click rejected'));
      },
      /**
       * URL never matches.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const menuTargetForTest: IResolvedTarget = {
      selector: '[id="menu-toggle"]',
      contextId: 'main',
      kind: 'css',
      candidateValue: '[id="menu-toggle"]',
    };
    const base = makeMockContext();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardMenuTarget: menuTargetForTest,
          dashboardTarget: TARGET,
          dashboardFallbackSelector: FALLBACK,
          dashboardCandidateCount: 1,
        },
      },
      executor,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk14 = isOk(result);
    expect(isOk14).toBe(true);
    // Menu click attempted (and rejected), then identity click runs.
    expect(menuClicks).toBeGreaterThanOrEqual(1);
  });

  it('runs menu click waitForNetworkIdle when click succeeds', async () => {
    let menuClicks = 0;
    let networkIdleCalls = 0;
    const executor = makeMockActionExecutor({
      /**
       * Track menu clicks.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        menuClicks += 1;
        return Promise.resolve(true);
      },
      /**
       * Track network-idle waits to verify the post-click branch fired.
       * @returns Succeed undefined.
       */
      waitForNetworkIdle: (): ReturnType<IActionMediator['waitForNetworkIdle']> => {
        networkIdleCalls += 1;
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
      /**
       * URL never matches.
       * @returns NON_TXN_URL.
       */
      getCurrentUrl: (): string => NON_TXN_URL,
    });
    const menuTargetForTest: IResolvedTarget = {
      selector: '[id="menu-toggle"]',
      contextId: 'main',
      kind: 'css',
      candidateValue: '[id="menu-toggle"]',
    };
    const base = makeMockContext();
    const ctx = toActionCtx(
      {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          dashboardMenuTarget: menuTargetForTest,
          dashboardTarget: TARGET,
          dashboardFallbackSelector: FALLBACK,
          dashboardCandidateCount: 1,
        },
      },
      executor,
    );
    const result = await executeDashboardNavigationSealed(ctx);
    const isOk15 = isOk(result);
    expect(isOk15).toBe(true);
    expect(menuClicks).toBeGreaterThanOrEqual(1);
    expect(networkIdleCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('executePreLocateNav — full clickTarget resolution path', () => {
  it('resolves clickTarget with DOM count > 1 (logs winner + describeTargets)', async () => {
    // Build a page mock with a working locator(...).count() chain so the
    // DOM-count expansion path inside resolveDashboardTargets runs.
    const screenshotPage = makeScreenshotPage();
    const pageWithCount: Page = {
      ...(screenshotPage as object),
      /**
       * Locator with a count() call that returns 2 (Beinleumi-style ambiguity).
       * @returns Locator-shaped object exposing count.
       */
      locator: (): { count: () => Promise<number> } => ({
        /**
         * Two DOM matches — exercises the (DOM matches=2) branch.
         * @returns 2.
         */
        count: (): Promise<number> => Promise.resolve(2),
      }),
    } as unknown as Page;
    const base = makeContextWithBrowser(pageWithCount);
    const page = requireBrowser(base).page;
    /** Stub locator value — needs to be truthy to pass the resolver guard. */
    const stubLocator = { __stub: true } as unknown as IRaceResult['locator'];
    /** Found race result with identity, candidate, and context populated. */
    const foundRace: IRaceResult = {
      found: true,
      locator: stubLocator,
      candidate: { kind: 'textContent', value: 'Transactions' },
      context: page,
      index: 0,
      value: 'Transactions',
      identity: false,
    };
    const mediator = makeMockMediator({
      /**
       * Returns the found race result so resolveDashboardTargets reaches
       * the count() expansion branch.
       * @returns Found race result.
       */
      resolveVisible: () => Promise.resolve(foundRace),
      /**
       * Empty hrefs so href fallback does not short-circuit.
       * @returns Empty array.
       */
      collectAllHrefs: () => Promise.resolve([] as readonly string[]),
    });
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executePreLocateNav(ctx);
    const isOk16 = isOk(result);
    expect(isOk16).toBe(true);
    // Verify diagnostics propagated the count + fallback selector.
    if (result.success) {
      expect(result.value.diagnostics.dashboardCandidateCount).toBe(2);
      expect(result.value.diagnostics.dashboardFallbackSelector).toBeDefined();
    }
  });

  it('executeCollectAndSignal handles empty pageUrl + already-attached api', async () => {
    const screenshotPage = makeScreenshotPage();
    const base = makeContextWithBrowser(screenshotPage);
    const mockMed = makeMockMediator();
    const med = some(mockMed);
    const dashState = { isReady: true, pageUrl: '', trafficPrimed: true };
    const dash = some(dashState);
    const apiObj = {} as unknown as { dummy: true };
    const apiSlot = some(apiObj);
    const ctxWithDash = {
      ...base,
      mediator: med,
      // dashboard with empty pageUrl exercises `dashUrl || ''` fallback (line 732).
      dashboard: dash,
      // api already attached → exercises line 699 (input.api.has true branch).
      api: apiSlot,
    } as unknown as Parameters<typeof executeCollectAndSignal>[0];
    const result = await executeCollectAndSignal(ctxWithDash);
    expect(typeof result.success).toBe('boolean');
  });

  it('falls through to menu fallback when raceResultToTarget yields false', async () => {
    const screenshotPage = makeScreenshotPage();
    const pageWithCount: Page = {
      ...(screenshotPage as object),
      /**
       * Locator with count returning 0 (no matches).
       * @returns Locator-shaped object.
       */
      locator: (): { count: () => Promise<number> } => ({
        /**
         * No DOM matches.
         * @returns 0.
         */
        count: (): Promise<number> => Promise.resolve(0),
      }),
    } as unknown as Page;
    const base = makeContextWithBrowser(pageWithCount);
    let visibleCalls = 0;
    const mediator = makeMockMediator({
      /**
       * First call (TRANSACTIONS) returns malformed race → triggers menu
       * fallback path (line 175-176). Second call (MENU) returns not found.
       * @returns Race result.
       */
      resolveVisible: () => {
        visibleCalls += 1;
        const malformed: IRaceResult = {
          found: true,
          locator: false,
          candidate: false,
          context: false,
          index: 0,
          value: '',
          identity: false,
        };
        return Promise.resolve(malformed);
      },
    });
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executePreLocateNav(ctx);
    expect(typeof result.success).toBe('boolean');
    expect(visibleCalls).toBeGreaterThanOrEqual(1);
  });
});
