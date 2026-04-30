/**
 * Extra coverage for HomeActions — Promise-rejection / catch branches.
 * Split from HomeActionsExtra.test.ts to honor max-lines.
 */

import type {
  IActionMediator,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeHomeNavigation,
  executeModalClick,
  executeNavigateToLogin,
  executeValidateLoginArea,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type {
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeMediator, SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';

// ── Promise-rejection coverage for .catch((): false => false) lambdas ─────

/**
 * Build a mediator whose methods REJECT — exercises the .catch(false) branches.
 * @param urls - Parameter.
 * @returns Mock mediator whose methods reject.
 */
function makeRejectingMediator(urls: string[] = []): IElementMediator {
  const hrefs: readonly string[] = urls;
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getCurrentUrl: (): string => 'https://bank.co.il',
    /**
     * Test helper.
     *
     * @returns Result.
     */
    resolveVisible: (): Promise<never> => Promise.reject(new Error('visible-fail')),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    resolveAndClick: (): Promise<never> => Promise.reject(new Error('click-fail')),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('idle-fail')),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(hrefs),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    navigateTo: (): Promise<never> => Promise.reject(new Error('nav-fail')),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    waitForURL: (): Promise<never> => Promise.reject(new Error('wait-url-fail')),
  } as unknown as IElementMediator;
}

describe('executeNavigateToLogin — catch branches fire on rejections', () => {
  it('DIRECT: swallows resolveAndClick rejection via .catch', async () => {
    const ctx = makeMockContext();
    const mediator = makeRejectingMediator();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('SEQUENTIAL: swallows all rejections in trigger+menu+waitForURL', async () => {
    const ctx = makeMockContext();
    const mediator = makeRejectingMediator();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [{ kind: 'textContent', value: 'Login' }],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('executeValidateLoginArea swallows resolveVisible rejection', async () => {
    const ctx = makeMockContext({ browser: { has: false } as IPipelineContext['browser'] });
    const mediator = makeRejectingMediator();
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.co.il',
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('tryFallbackNavigation: find() predicate + .some lambda fire when href matches', async () => {
    // Use a mediator where hrefs include login-like + non-login URLs to hit the
    // find() predicate lambda (anonymous_N in HomeActions:152).
    const ctx = makeMockContext();
    const mediator = makeMediator({
      url: 'https://bank.co.il',
      allHrefs: ['https://bank.co.il/promos', 'https://bank.co.il/auth/landing'],
    });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('tryFallbackNavigation: find() returns false when no href matches pattern', async () => {
    const ctx = makeMockContext();
    const mediator = makeMediator({
      url: 'https://bank.co.il',
      allHrefs: ['https://bank.co.il/promos', 'https://bank.co.il/about'],
    });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });
});

describe('executeStoreLoginSignal + executeModalClick — catch lambdas fire', () => {
  it('executeStoreLoginSignal swallows resolveVisible rejection in waitForFormReady (line 248)', async () => {
    const { executeStoreLoginSignal } =
      await import('../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js');
    const ctx = makeMockContext();
    const mediator = makeRejectingMediator();
    const result = await executeStoreLoginSignal(mediator, ctx, LOG);
    expect(result.success).toBe(true);
  });

  it('executeModalClick swallows clickElement + waitForNetworkIdle rejections (lines 299/301)', async () => {
    const executor = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      clickElement: (): Promise<never> => Promise.reject(new Error('click fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('idle fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: () => {
        const succeeded = succeed(false);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.co.il',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: (): Promise<never> => Promise.reject(new Error('nav fail')),
    } as unknown as IActionMediator;
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#modal',
      kind: 'css',
      candidateValue: '#modal',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.MODAL,
      triggerText: 'Modal',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeModalClick(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });

  it('settleAfterClick swallows all three rejections via executeHomeNavigation (lines 335/337/338)', async () => {
    const executor = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('idle fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: (): Promise<never> => Promise.reject(new Error('url fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/login',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: (): Promise<never> => Promise.reject(new Error('nav fail')),
    } as unknown as IActionMediator;
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#t',
      kind: 'css',
      candidateValue: '#t',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [{ kind: 'textContent', value: 'L' }],
      triggerTarget: target,
    };
    // Use the SEQUENTIAL branch so settleAfterClick runs waitForNetworkIdle first.
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(typeof isOk).toBe('boolean');
  });

  it('tryFallbackNav swallows navigateTo rejection (line 354)', async () => {
    const executor = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: () => {
        const succeeded = succeed(false);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.co.il',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      collectAllHrefs: (): Promise<readonly string[]> =>
        Promise.resolve(['https://bank.co.il/personalarea/login']),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: (): Promise<never> => Promise.reject(new Error('nav fail')),
    } as unknown as IActionMediator;
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#t',
      kind: 'css',
      candidateValue: '#t',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'x',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(typeof isOk).toBe('boolean');
  });

  it('executeNavigateToLogin: fallback navigateTo rejection (line 170)', async () => {
    // Mediator with rejecting navigateTo so the .catch in tryFallbackNavigation fires.
    const mediator: IElementMediator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.co.il',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveVisible: () => Promise.resolve(NOT_FOUND_RESULT),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveAndClick: () => {
        const succeeded = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: () => {
        const succeeded = succeed(false);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      collectAllHrefs: (): Promise<readonly string[]> =>
        Promise.resolve(['https://bank.co.il/personalarea/login']),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: (): Promise<never> => Promise.reject(new Error('nav fail')),
    } as unknown as IElementMediator;
    const ctx = makeMockContext();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });
});
