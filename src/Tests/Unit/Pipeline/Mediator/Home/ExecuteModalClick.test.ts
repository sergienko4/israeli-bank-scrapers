/**
 * Coverage backfill — `executeModalClick` (Phase 7 left this exported
 * helper untested; the new ACCOUNT-RESOLVE phase narrowed coverage
 * margins enough that this gap blocks the gate). Pure mediator unit.
 */

import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeHomeNavigation,
  executeModalClick,
  executeStoreLoginSignal,
  tryClickLoginLink,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Shape of the discovery argument `executeModalClick` accepts. */
interface IDiscoveryStub {
  readonly triggerTarget?: { readonly contextId: string; readonly selector: string };
}

/** No-op logger stub matching the ScraperLogger surface. */
const NOOP_LOGGER: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build a mock executor that records click + idle invocations.
 * @returns Tuple of executor + call log.
 */
function makeExecutor(): {
  readonly executor: IActionMediator;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const executor = {
    /**
     * Records the click and resolves true.
     * @returns Resolved true.
     */
    clickElement: (): Promise<true> => {
      calls.push('click');
      return Promise.resolve(true);
    },
    /**
     * Records the idle wait and resolves succeed.
     * @returns Resolved succeed.
     */
    waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> => {
      calls.push('idle');
      return Promise.resolve({ success: true, value: true });
    },
  } as unknown as IActionMediator;
  return { executor, calls };
}

/**
 * Stage-isolation regression: live E2E showed Hapoalim/Amex/Isracard
 * crash mid-HOME.ACTION when Playwright's locator.click throws on a
 * 15s timeout (CDN slow under 6-bank parallel load). The handler
 * must absorb clickElement rejection the same way MODAL does — let
 * settleAfterClick + POST decide success via URL change. Both DIRECT
 * and SEQUENTIAL exercise the same `.catch` path; deduplicated via
 * `it.each` per the project's table-driven test convention
 * (LoginFactoryTest, OtpFillFactoryTest, AuthDiscoveryFactoryTest).
 */
interface IRejectionStrategyCase {
  readonly strategy: 'DIRECT' | 'SEQUENTIAL';
  readonly label: 'DIRECT' | 'SEQUENTIAL';
}

const REJECTION_STRATEGY_CASES: readonly IRejectionStrategyCase[] = [
  { strategy: 'DIRECT', label: 'DIRECT' },
  { strategy: 'SEQUENTIAL', label: 'SEQUENTIAL' },
];

/**
 * Build an executor whose `clickElement` rejects with a Playwright
 * timeout signature; URL never changes; waits resolve cleanly.
 * Shared between the DIRECT and SEQUENTIAL rejection cases.
 *
 * @param stableUrl - URL the executor reports throughout the run.
 * @returns Action mediator stub matching `IActionMediator`.
 */
function makeRejectingClickExecutor(stableUrl: string): IActionMediator {
  return {
    /**
     * URL never changes — click never lands navigation.
     * @returns Stable URL.
     */
    getCurrentUrl: (): string => stableUrl,
    /**
     * Reject with the Playwright click() timeout signature.
     * @returns Rejected promise.
     */
    clickElement: (): Promise<never> =>
      Promise.reject(new Error('locator.click: Timeout 15000ms exceeded')),
    /**
     * Idle resolves succeed; settleAfterClick still runs.
     * @returns Resolved succeed(true).
     */
    waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> =>
      Promise.resolve({ success: true, value: true }),
    /**
     * URL wait resolves false (no navigation occurred).
     * @returns Resolved succeed(false).
     */
    waitForURL: (): Promise<{ success: true; value: boolean }> =>
      Promise.resolve({ success: true, value: false }),
  } as unknown as IActionMediator;
}

describe('tryClickLoginLink (Phase 7 backfill)', () => {
  it('delegates resolveAndClick to the mediator', async () => {
    const calls: string[] = [];
    const mediator = {
      /**
       * Records the call and returns a NOT_FOUND_RESULT-shaped success.
       * @returns Resolved succeed.
       */
      resolveAndClick: (): Promise<Procedure<IRaceResult>> => {
        calls.push('resolveAndClick');
        const ok = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(ok);
      },
    } as unknown as IElementMediator;
    const result = await tryClickLoginLink(mediator);
    expect(result.success).toBe(true);
    expect(calls).toEqual(['resolveAndClick']);
  });
});

describe('executeModalClick (Phase 7 backfill)', () => {
  it('returns false when discovery has no triggerTarget — guard branch', async () => {
    const { executor } = makeExecutor();
    const discovery: IDiscoveryStub = {};
    const stub = discovery as unknown as Parameters<typeof executeModalClick>[1];
    const didClick = await executeModalClick(executor, stub, NOOP_LOGGER);
    expect(didClick).toBe(false);
  });

  it('clicks the resolved triggerTarget then waits for network idle', async () => {
    const { executor, calls } = makeExecutor();
    const discovery: IDiscoveryStub = {
      triggerTarget: { contextId: 'main', selector: '[data-testid="login-modal"]' },
    };
    const stub = discovery as unknown as Parameters<typeof executeModalClick>[1];
    const didClick = await executeModalClick(executor, stub, NOOP_LOGGER);
    expect(didClick).toBe(true);
    expect(calls).toEqual(['click', 'idle']);
  });

  it('swallows clickElement rejection (.catch branch) and still waits for idle', async () => {
    const calls: string[] = [];
    const executor = {
      /**
       * Reject to exercise the .catch branch on clickElement.
       * @returns Rejected promise.
       */
      clickElement: (): Promise<never> => {
        calls.push('click-reject');
        return Promise.reject(new Error('detached'));
      },
      /**
       * Idle resolves succeed so the function returns true.
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> => {
        calls.push('idle');
        return Promise.resolve({ success: true, value: true });
      },
    } as unknown as IActionMediator;
    const discovery: IDiscoveryStub = {
      triggerTarget: { contextId: 'main', selector: '#open-modal' },
    };
    const stub = discovery as unknown as Parameters<typeof executeModalClick>[1];
    const didClick = await executeModalClick(executor, stub, NOOP_LOGGER);
    expect(didClick).toBe(true);
    expect(calls).toEqual(['click-reject', 'idle']);
  });

  it('executeHomeNavigation: returns false when triggerTarget is missing — early guard', async () => {
    const { executor } = makeExecutor();
    const discovery = { strategy: 'DIRECT' as const } as unknown as Parameters<
      typeof executeHomeNavigation
    >[1];
    const didNavigate = await executeHomeNavigation(executor, discovery, NOOP_LOGGER);
    expect(didNavigate).toBe(false);
  });

  it('executeHomeNavigation: MODAL strategy delegates to executeModalClick', async () => {
    const { executor, calls } = makeExecutor();
    const discovery = {
      strategy: 'MODAL' as const,
      triggerTarget: { contextId: 'main', selector: '#open' },
    } as unknown as Parameters<typeof executeHomeNavigation>[1];
    const didNavigate = await executeHomeNavigation(executor, discovery, NOOP_LOGGER);
    expect(didNavigate).toBe(true);
    expect(calls).toContain('click');
    expect(calls).toContain('idle');
  });

  it('executeHomeNavigation: DIRECT strategy with no URL change reports didNavigate=false', async () => {
    // DIRECT doesn't trigger the SEQUENTIAL idle branch; URL remains
    // unchanged so didNavigate=false. Exercises the !isSeq branch in
    // settleAfterClick + the urlBefore===currentUrl path.
    const stableUrl = 'https://bank.example.com/home';
    const executor = {
      /**
       * Returns the same URL each call (no navigation).
       * @returns Stable URL.
       */
      getCurrentUrl: (): string => stableUrl,
      /**
       * Click does not navigate (URL stays the same).
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * Idle resolves successfully.
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> =>
        Promise.resolve({ success: true, value: true }),
      /**
       * URL wait resolves false (URL didn't change).
       * @returns Resolved succeed(false).
       */
      waitForURL: (): Promise<{ success: true; value: boolean }> =>
        Promise.resolve({ success: true, value: false }),
    } as unknown as IActionMediator;
    const discovery = {
      strategy: 'DIRECT' as const,
      triggerTarget: { contextId: 'main', selector: '#login' },
    } as unknown as Parameters<typeof executeHomeNavigation>[1];
    const didNavigate = await executeHomeNavigation(executor, discovery, NOOP_LOGGER);
    expect(didNavigate).toBe(false);
  });

  it('executeHomeNavigation: SEQUENTIAL strategy hits settleAfterClick — both rejection branches', async () => {
    // Coverage backfill — Phase 7 squeezed margins so the SEQUENTIAL
    // settleAfterClick branch (waitForNetworkIdle + waitForURL +
    // waitForNetworkIdle, all wrapped in .catch) needs explicit
    // exercise. Reject every executor call so all three arrows fire.
    let urlState = 'https://bank.example.com/home';
    const rejectingExecutor = {
      /**
       * Records URL on each call so didNavigate computes against
       * mutated state.
       * @returns Current URL string.
       */
      getCurrentUrl: (): string => urlState,
      /**
       * Click resolves true and bumps the URL so didNavigate=true.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        urlState = 'https://bank.example.com/login';
        return Promise.resolve(true);
      },
      /**
       * Reject so the .catch arrow at settleAfterClick lines 205/208
       * is exercised.
       * @returns Rejected promise.
       */
      waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('idle-timeout')),
      /**
       * Reject so the .catch arrow at settleAfterClick line 207 is
       * exercised.
       * @returns Rejected promise.
       */
      waitForURL: (): Promise<never> => Promise.reject(new Error('url-timeout')),
    } as unknown as IActionMediator;
    const discovery = {
      strategy: 'SEQUENTIAL' as const,
      triggerTarget: { contextId: 'main', selector: 'a[href="/login"]' },
    } as unknown as Parameters<typeof executeHomeNavigation>[1];
    const didNavigate = await executeHomeNavigation(rejectingExecutor, discovery, NOOP_LOGGER);
    expect(didNavigate).toBe(true);
  });

  it.each(REJECTION_STRATEGY_CASES)(
    'executeHomeNavigation: $label clickElement rejection resolves false (no unhandled crash)',
    async ({ strategy }) => {
      const executor = makeRejectingClickExecutor('https://bank.example.com/home');
      const discovery = {
        strategy,
        triggerTarget: { contextId: 'main', selector: 'a[href="/login"]' },
      } as unknown as Parameters<typeof executeHomeNavigation>[1];
      const didNavigate = await executeHomeNavigation(executor, discovery, NOOP_LOGGER);
      expect(didNavigate).toBe(false);
    },
  );

  it('executeStoreLoginSignal: stamps loginUrl into diagnostics', async () => {
    // Coverage backfill — Phase 7 squeezed margins so this exported
    // helper now needs a unit. Stubs out resolveVisible so
    // waitForFormReady's gate check resolves immediately.
    const mediator = {
      /**
       * Returns the bank's login URL.
       * @returns Mock URL.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/login',
      /**
       * Resolve a NOT_FOUND so waitForFormReady returns false (still
       * succeeds the FINAL stage; loginUrl always gets stamped).
       * @returns Resolved NOT_FOUND_RESULT.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(NOT_FOUND_RESULT),
    } as unknown as IElementMediator;
    const ctx = makeMockContext();
    const result = await executeStoreLoginSignal(mediator, ctx, NOOP_LOGGER);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.loginUrl).toBe('https://bank.example.com/login');
    }
  });

  it('swallows waitForNetworkIdle rejection (.catch branch) and still returns true', async () => {
    const calls: string[] = [];
    const executor = {
      /**
       * Click resolves true.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        calls.push('click');
        return Promise.resolve(true);
      },
      /**
       * Idle rejects to exercise the .catch branch.
       * @returns Rejected promise.
       */
      waitForNetworkIdle: (): Promise<never> => {
        calls.push('idle-reject');
        return Promise.reject(new Error('idle-timeout'));
      },
    } as unknown as IActionMediator;
    const discovery: IDiscoveryStub = {
      triggerTarget: { contextId: 'main', selector: '#open-modal' },
    };
    const stub = discovery as unknown as Parameters<typeof executeModalClick>[1];
    const didClick = await executeModalClick(executor, stub, NOOP_LOGGER);
    expect(didClick).toBe(true);
    expect(calls).toEqual(['click', 'idle-reject']);
  });
});
