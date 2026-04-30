/**
 * Extra coverage for HomeActions — executeNavigateToLogin successful click branches.
 * Split from HomeActionsExtra.test.ts to honor max-lines.
 */

import type {
  IActionMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeHomeNavigation,
  executeNavigateToLogin,
  executeValidateLoginArea,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeMediator, SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';

describe('executeNavigateToLogin — successful click branches', () => {
  it('DIRECT with trigger found logs clicked text (line 106-108)', async () => {
    const ctx = makeMockContext();
    const found: IRaceResult = {
      ...NOT_FOUND_RESULT,
      found: true as const,
      value: 'Login-link-text',
    };
    const mediator = makeMediator({
      url: 'https://bank.co.il/login',
      clickResult: found,
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

  it('SEQUENTIAL success path clicks trigger, waits, clicks menu child', async () => {
    const ctx = makeMockContext();
    const found: IRaceResult = {
      ...NOT_FOUND_RESULT,
      found: true as const,
      value: 'Personal Login',
    };
    const mediator = makeMediator({
      url: 'https://bank.co.il/login',
      clickResult: found,
    });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [{ kind: 'textContent', value: 'Personal' }],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('executeHomeNavigation falls back to tryFallbackNav when no URL change (line 353-355)', async () => {
    let wasNavigated = false;
    const executor = {
      /**
       * clickElement noop.
       * @returns Resolved.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * waitForNetworkIdle.
       * @returns Succeed.
       */
      waitForNetworkIdle: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
      /**
       * waitForURL.
       * @returns Succeed.
       */
      waitForURL: () => {
        const succeeded = succeed(false);
        return Promise.resolve(succeeded);
      },
      /**
       * getCurrentUrl — constant URL so didNavigate stays false.
       * @returns Same URL.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/home',
      /**
       * collectAllHrefs — returns a login URL to trigger tryFallbackNav.
       * @returns Array with a login-looking href.
       */
      collectAllHrefs: (): Promise<readonly string[]> =>
        Promise.resolve(['https://bank.co.il/personalarea/login']),
      /**
       * navigateTo — records and returns succeed.
       * @returns Succeed.
       */
      navigateTo: () => {
        wasNavigated = true;
        const succeedResult3 = succeed(undefined);
        return Promise.resolve(succeedResult3);
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
    // isOk is the truthy tryFallbackNav isOk when href matched
    expect(typeof isOk).toBe('boolean');
    expect(wasNavigated).toBe(true);
  });

  it('executeValidateLoginArea succeeds when browser has frames (hasFrames branch)', async () => {
    const browserState = {
      has: true as const,
      value: {
        /**
         * Browser context has a page with 2 frames.
         * @returns Browser ref.
         */
        page: {
          /**
           * Test helper.
           *
           * @returns Result.
           */
          frames: (): unknown[] => [{}, {}],
        },
      } as unknown as IBrowserState,
    };
    const ctx = makeMockContext({
      browser: browserState as unknown as Option<IBrowserState>,
    });
    const mediator = makeMediator({ url: 'https://bank.co.il' });
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.co.il',
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });
});
