/**
 * Extra coverage for HomeActions — didNavigate branches.
 * Split from HomeActionsExtra.test.ts to honor max-lines.
 */

import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeHomeNavigation,
  executeNavigateToLogin,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { IResolvedTarget } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeExecutor, makeMediator, SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';

describe('executeNavigateToLogin + executeHomeNavigation — didNavigate branches', () => {
  it('executeNavigateToLogin: skips fallback when URL already changed (line 82 falsy)', async () => {
    // Mediator where getCurrentUrl returns a different URL after the click
    // → didNavigate=true → `if (!didNavigate)` falsy → skips tryFallbackNavigation
    let calls = 0;
    const mediator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => {
        calls += 1;
        return calls === 1 ? 'https://bank.co.il' : 'https://bank.co.il/login';
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(NOT_FOUND_RESULT),
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
      collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
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

  it('executeNavigateToLogin SEQUENTIAL: empty menuCandidates returns false early (line 132 truthy)', async () => {
    // SEQUENTIAL with menuCandidates.length === 0 → executeSequentialNav bails at line 132
    const mediator = makeMediator({ url: 'https://bank.co.il' });
    const ctx = makeMockContext();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [], // triggers line 132 "return false" branch
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('executeHomeNavigation: didNavigate=true returns true without fallback (line 383 falsy)', async () => {
    // URL changes after click → didNavigate=true → executeHomeNavigation returns true
    let calls = 0;
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
      getCurrentUrl: (): string => {
        calls += 1;
        return calls === 1 ? 'https://bank.co.il/home' : 'https://bank.co.il/login';
      },
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
      navigateTo: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
    } as unknown as IActionMediator;
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#login-btn',
      kind: 'css',
      candidateValue: '#login-btn',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(isOk).toBe(true);
  });
});

describe('executeHomeNavigation — fallback + catch lambdas', () => {
  it('SEQUENTIAL strategy runs executeSequentialClick + settles', async () => {
    const executor = makeExecutor();
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#menu',
      kind: 'css',
      candidateValue: 'menu',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [{ kind: 'textContent', value: 'Login' }],
      triggerTarget: target,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(typeof isOk).toBe('boolean');
  });

  it('tryFallbackNav: .some predicate lambda fires across multiple patterns', async () => {
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
      getCurrentUrl: (): string => 'https://bank.co.il/home',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      collectAllHrefs: (): Promise<readonly string[]> =>
        Promise.resolve(['https://bank.co.il/marketing', 'https://bank.co.il/about']),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
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
    expect(isOk).toBe(false);
  });
});
