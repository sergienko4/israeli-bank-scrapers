/**
 * Unit tests for LoginPhaseActions — deep branches split from the main file.
 * Covers resolved fields / submit discovery / redirect path / edge cases.
 */

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import { executeDiscoverForm } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IFieldContext } from '../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeContextWithBrowser } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   * @param message - Parameter.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Narrow a ctx.browser field to ISome and return the state.
 * @param ctx - Parameter.
 * @param ctx.browser - Browser option.
 * @param ctx.browser.has - Present flag.
 * @returns Result.
 */
function requireBrowser(ctx: { browser: { has: boolean } }): IBrowserState {
  if (!ctx.browser.has) throw new TestError('expected browser state');
  return (ctx.browser as { has: true; value: IBrowserState }).value;
}

// ── Deep coverage: resolveOneField SUCCESS + submit discovery ───────
describe('executeDiscoverForm — resolved fields exercise submit paths', () => {
  it('discovers form anchor when resolveField succeeds (triggers discoverFormFromField)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const { succeed: succeedFn } = await import('../../../../Scrapers/Pipeline/Types/Procedure.js');
    const { some: someOpt } = await import('../../../../Scrapers/Pipeline/Types/Option.js');
    const makeScreenshotPageResult39 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult39);
    const frame = requireBrowser(browserCtx).page;
    const fieldCtx = {
      selector: '#pwd',
      context: frame,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    const typedFieldCtx = fieldCtx as unknown as IFieldContext;
    const formAnchor = { frame, selector: 'form' } as unknown as IFormAnchor;
    const mediator = makeMockMediator({
      /**
       * Return success field context for any field.
       * @returns Success procedure.
       */
      resolveField: () => {
        const ok = succeedFn(typedFieldCtx);
        return Promise.resolve(ok);
      },
      /**
       * Discover form anchor returns some.
       * @returns Some anchor.
       */
      discoverForm: () => {
        const opt = someOpt(formAnchor);
        return Promise.resolve(opt);
      },
      /**
       * Return not-found for resolveVisible so buildSubmitSelector path varies.
       * @returns NOT_FOUND.
       */
      resolveVisible: () => Promise.resolve(notFoundResult),
      /**
       * Return scoped candidates unchanged.
       * @param candidates - Input.
       * @returns Same.
       */
      scopeToForm: candidates => candidates,
    });
    const ctx = { ...browserCtx, mediator: someOpt(mediator) };
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
      ],
      submit: [{ kind: 'textContent' as const, value: 'Login' }],
      possibleResults: {},
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult40 = isOk(result);
    expect(isOkResult40).toBe(true);
    if (isOk(result) && result.value.loginFieldDiscovery.has) {
      const disc = result.value.loginFieldDiscovery.value;
      expect(disc.targets.size).toBeGreaterThan(0);
    }
  });

  it('succeeds with submit resolved in correct frame', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { succeed: succeedFn } = await import('../../../../Scrapers/Pipeline/Types/Procedure.js');
    const { some: someOpt, none: noneOpt } =
      await import('../../../../Scrapers/Pipeline/Types/Option.js');
    const makeScreenshotPageResult41 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult41);
    const frame = requireBrowser(browserCtx).page;
    const fieldCtx = {
      selector: '#pwd',
      context: frame,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    /** Submit locator result: found in main frame (same as password). */
    const submitRace = {
      found: true,
      locator: false,
      candidate: { kind: 'textContent', value: 'Login' },
      context: frame,
      index: 0,
      value: 'Login',
    };
    const typedFieldCtx = fieldCtx as unknown as IFieldContext;
    const typedSubmitRace = submitRace as unknown as IRaceResult;
    const mediator = makeMockMediator({
      /**
       * Resolve field succeeds.
       * @returns Success.
       */
      resolveField: () => {
        const ok = succeedFn(typedFieldCtx);
        return Promise.resolve(ok);
      },
      /**
       * Discover form returns none.
       * @returns None.
       */
      discoverForm: () => {
        const noneValue = noneOpt();
        return Promise.resolve(noneValue);
      },
      /**
       * Return found visible submit.
       * @returns Found race result.
       */
      resolveVisible: () => Promise.resolve(typedSubmitRace),
    });
    const ctx = { ...browserCtx, mediator: someOpt(mediator) };
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
      ],
      submit: { kind: 'textContent' as const, value: 'Login' },
      possibleResults: {},
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult42 = isOk(result);
    expect(isOkResult42).toBe(true);
    if (isOk(result) && result.value.loginFieldDiscovery.has) {
      expect(result.value.loginFieldDiscovery.value.submitTarget.has).toBe(true);
    }
  });

  it('tests multiple submit selector kinds (xpath, exactText, ariaLabel, labelText)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { succeed: succeedFn } = await import('../../../../Scrapers/Pipeline/Types/Procedure.js');
    const { some: someOpt, none: noneOpt } =
      await import('../../../../Scrapers/Pipeline/Types/Option.js');
    const makeScreenshotPageResult43 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult43);
    const frame = requireBrowser(browserCtx).page;
    const fieldCtx = {
      selector: '#pwd',
      context: frame,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    /** Kinds to rotate through buildSubmitSelector branches. */
    const kinds = ['xpath', 'exactText', 'ariaLabel', 'labelText', 'textContent'] as const;
    const typedFieldCtx = fieldCtx as unknown as IFieldContext;
    /**
     * Run a single kind through the pipeline and return whether it succeeded.
     * @param kind - Selector kind.
     * @returns Whether executeDiscoverForm was OK.
     */
    const runOne = (kind: (typeof kinds)[number]): Promise<boolean> => {
      const submitRace = {
        found: true,
        locator: false,
        candidate: { kind, value: '//button' },
        context: frame,
        index: 0,
        value: 'x',
      };
      const typedSubmitRace = submitRace as unknown as IRaceResult;
      const mediator = makeMockMediator({
        /**
         * Resolve field succeeds.
         * @returns Success.
         */
        resolveField: () => {
          const ok = succeedFn(typedFieldCtx);
          return Promise.resolve(ok);
        },
        /**
         * Discover form none.
         * @returns None.
         */
        discoverForm: () => {
          const noneValue = noneOpt();
          return Promise.resolve(noneValue);
        },
        /**
         * Return canned race result per kind.
         * @returns Race.
         */
        resolveVisible: () => Promise.resolve(typedSubmitRace),
      });
      const ctx = { ...browserCtx, mediator: someOpt(mediator) };
      const cfg = {
        loginUrl: 'https://bank.example.com/login',
        fields: [
          {
            credentialKey: 'password',
            selectors: [{ kind: 'placeholder' as const, value: 'pwd' }],
          },
        ],
        submit: { kind: 'textContent' as const, value: 'Login' },
        possibleResults: {},
      };
      return executeDiscoverForm(cfg as unknown as ILoginConfig, ctx).then(result => isOk(result));
    };
    const runs = kinds.map(runOne);
    const results = await Promise.all(runs);
    for (const isOkResult44 of results) {
      expect(isOkResult44).toBe(true);
    }
  });
});
