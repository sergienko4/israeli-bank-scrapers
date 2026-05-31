/**
 * Branch coverage extensions for PreLoginPhaseActions.
 */

import type { Page } from 'playwright-core';

import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFireRevealClicksSealed,
  executePreLocateReveal,
} from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPreLoginDiscovery,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

const MOCK_TARGET: IResolvedTarget = {
  selector: 'button',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Enter',
};

describe('PreLoginPhaseActions — branch completion', () => {
  it('resolveRevealFromBrowser: no browser → returns false', async () => {
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const mediator = makeMockMediator({
      /**
       * All probes find a target — reveal-first flow proceeds straight to resolve.
       * @returns Found.
       */
      resolveVisible: () =>
        Promise.resolve({
          ...notFoundResult,
          found: true as const,
          candidate: { kind: 'textContent', value: 'Reveal' },
          context: null as unknown as Page,
          value: 'Reveal',
        } as unknown as IRaceResult),
      /**
       * URL getter.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/home',
    });
    // No browser attached — exercises !input.browser.has in resolveRevealFromBrowser
    const ctx = makeMockContext({ mediator: some(mediator) });
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('resolveRevealTarget: resolveVisible rejects → returns false', async () => {
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    let count = 0;
    const mediator = makeMockMediator({
      /**
       * Probe #1 finds reveal, probe #2 not found, resolveRevealFromBrowser rejects.
       * @returns Varied.
       */
      resolveVisible: () => {
        count += 1;
        if (count === 1) {
          return Promise.resolve({
            ...notFoundResult,
            found: true as const,
            candidate: { kind: 'textContent', value: 'P' },
            context: null as unknown as Page,
            value: 'P',
          } as unknown as IRaceResult);
        }
        if (count === 2) return Promise.resolve(notFoundResult);
        // call 3: resolveRevealTarget — reject
        return Promise.reject(new Error('resolve failed'));
      },
      /**
       * URL getter.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/home',
    });
    const makeScreenshotPageResult2 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult2);
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('executeSealedClick: no executor returns succeed (L150 !executor.has true branch)', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
      revealTarget: MOCK_TARGET,
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    // executor=false
    const ctx = toActionCtx(base, false);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('resolveRevealTarget: resolveVisible rejects inside reveal flow', async () => {
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    let count = 0;
    const mediator = makeMockMediator({
      /**
       * Probe #1 finds reveal; probe #2 NOT_FOUND; resolveRevealTarget rejects.
       * @returns Result.
       */
      resolveVisible: () => {
        count += 1;
        if (count === 1) {
          return Promise.resolve({
            ...notFoundResult,
            found: true as const,
            candidate: { kind: 'textContent', value: 'P' },
            context: null as unknown as Page,
            value: 'P',
          } as unknown as IRaceResult);
        }
        if (count === 2) return Promise.resolve(notFoundResult);
        // call 3: resolveRevealTarget — reject
        return Promise.reject(new Error('resolve-fail'));
      },
      /**
       * URL getter.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/home',
    });
    const makeScreenshotPageResult5 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult5);
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('resolveRevealTarget: resolveVisible returns not-found', async () => {
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    let count = 0;
    const mediator = makeMockMediator({
      /**
       * Probe #1 finds reveal; probe #2 + resolveRevealTarget return NOT_FOUND.
       * @returns Result.
       */
      resolveVisible: () => {
        count += 1;
        if (count === 1) {
          return Promise.resolve({
            ...notFoundResult,
            found: true as const,
            candidate: { kind: 'textContent', value: 'P' },
            context: null as unknown as Page,
            value: 'P',
          } as unknown as IRaceResult);
        }
        // probe #2 + resolveRevealTarget — both not found
        return Promise.resolve(notFoundResult);
      },
      /**
       * URL getter.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/home',
    });
    const makeScreenshotPageResult7 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult7);
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('fireRevealClicksSealed: CLICK branch with executor hits sealed click path', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
      revealTarget: MOCK_TARGET,
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const exec = makeMockActionExecutor();
    const ctx = toActionCtx(base, exec);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });
});
