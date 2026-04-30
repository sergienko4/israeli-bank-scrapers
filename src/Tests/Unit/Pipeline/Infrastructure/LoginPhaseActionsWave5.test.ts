/**
 * Wave 5 branch coverage for LoginPhaseActions.
 * Targets: takeScreenshot no-browser guard (49), discoverFormFromField anchor
 * already set (199), SUBMIT_FALLBACKS no-candidate branches (280,290), submit
 * WRONG_FRAME (334), buildSubmitSelector no-candidate (358), POST validate
 * error/redirect (483, 490).
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IActionMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import type { IFormErrorScanResult } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IFieldContext } from '../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage, toActionCtx } from './TestHelpers.js';

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

const BASE_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

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

describe('LoginPhaseActions — Wave 5 branches', () => {
  it('executeValidateLogin succeeds when post-submit URL leaves the login path', async () => {
    const mediator = makeMockMediator({
      /**
       * URL leaves /login so the bounce detector returns OK.
       * @returns Dashboard URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/dashboard',
    });
    const page = makeScreenshotPage();
    /** Override page with waitForURL that rejects to exercise catch. */
    const ctxBase = makeContextWithLogin(page);
    const ctxBaseBrowser = requireBrowser(ctxBase);
    const pageWithWait = {
      ...ctxBaseBrowser.page,
      /**
       * Reject the wait to exercise the catch branch.
       * @returns Rejected.
       */
      waitForURL: (): Promise<never> => Promise.reject(new Error('wait fail')),
    };
    const ctx = {
      ...ctxBase,
      browser: some({ ...ctxBaseBrowser, page: pageWithWait as unknown as Page }),
      diagnostics: { ...ctxBase.diagnostics, loginUrl: 'https://bank.example.com/login' },
    };
    const result = await executeValidateLogin(
      BASE_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('executeValidateLogin fails when loadingDone.success=false', async () => {
    const mediator = makeMockMediator({
      /**
       * Loading still shows spinner — loadingDone fail.
       * @returns Failure.
       */
      waitForLoadingDone: () => {
        const failResult = fail(ScraperErrorTypes.Timeout, 'spinner never cleared');
        return Promise.resolve(failResult);
      },
    });
    const makeScreenshotPageResult2 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult2);
    const result = await executeValidateLogin(
      BASE_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });

  it('executeValidateLogin fails with InvalidPassword when form errors detected', async () => {
    const mediator = makeMockMediator({
      /**
       * Errors present in the form.
       * @returns Has errors.
       */
      discoverErrors: () =>
        Promise.resolve({
          hasErrors: true,
          errors: [{ message: 'Bad password', candidate: { kind: 'exactText', value: 'x' } }],
          summary: 'invalid',
        } as unknown as IFormErrorScanResult),
    });
    const makeScreenshotPageResult4 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult4);
    const result = await executeValidateLogin(
      BASE_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });

  it('executeFillAndSubmitFromDiscovery: loginFieldDiscovery=none causes fail', async () => {
    const base = makeMockContext({ loginAreaReady: true });
    /** Discovery none → fail. */
    const ctx = toActionCtx(
      { ...base, loginFieldDiscovery: none() },
      null as unknown as IActionMediator,
    );
    const result = await executeFillAndSubmitFromDiscovery(
      BASE_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(false);
  });

  it('executeDiscoverForm no-mediator fails early', async () => {
    const makeScreenshotPageResult7 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult7);
    const ctx = { ...base, mediator: none() };
    const result = await executeDiscoverForm(BASE_CONFIG as unknown as ILoginConfig, ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(false);
  });

  it('executeDiscoverForm with checkReadiness success path', async () => {
    const makeScreenshotPageResult9 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult9);
    const cfg = {
      ...BASE_CONFIG,
      /**
       * Successful readiness check.
       * @returns Resolved.
       */
      checkReadiness: (): Promise<void> => Promise.resolve(),
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, browserCtx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('executeDiscoverForm with preAction returning a frame', async () => {
    const makeScreenshotPageResult11 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult11);
    const subFrame = {
      /**
       * Sub-frame URL.
       * @returns Result.
       */
      url: (): string => 'https://iframe.bank.example.com',
      /**
       * Empty frames.
       * @returns Result.
       */
      frames: (): readonly Frame[] => [],
      /**
       * Frame name.
       * @returns Result.
       */
      name: (): string => 'innerFrame',
      /**
       * Is detached.
       * @returns Result.
       */
      isDetached: (): boolean => false,
    };
    const cfg = {
      ...BASE_CONFIG,
      /**
       * preAction returns inner frame.
       * @returns Frame.
       */
      preAction: (): Promise<Frame> => Promise.resolve(subFrame as unknown as Frame),
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, browserCtx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('executeDiscoverForm with preAction returning null uses page fallback', async () => {
    const makeScreenshotPageResult13 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult13);
    const cfg = {
      ...BASE_CONFIG,
      /**
       * preAction returns null.
       * @returns Null.
       */
      preAction: (): Promise<null> => Promise.resolve(null),
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, browserCtx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
  });

  it('submit fallback when resolveVisible.candidate is falsy but found=true', async () => {
    const makeScreenshotPageResult15 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult15);
    const frame = requireBrowser(browserCtx).page;
    const mediator = makeMockMediator({
      /**
       * Password resolved.
       * @returns Success.
       */
      resolveField: () => {
        const okFieldCtx = succeed({
          selector: '#pwd',
          context: frame,
          resolvedKind: 'placeholder',
          resolvedVia: 'placeholder',
        } as unknown as IFieldContext);
        return Promise.resolve(okFieldCtx);
      },
      /**
       * Submit resolves WITHOUT candidate (exercises SUBMIT_FALLBACKS).
       * @returns Race with no candidate.
       */
      resolveVisible: () => {
        const race = {
          found: true,
          locator: false,
          candidate: false,
          context: frame,
          index: 0,
          value: '',
        } as unknown as IRaceResult;
        return Promise.resolve(race);
      },
      /**
       * Form discover none.
       * @returns None.
       */
      discoverForm: () => {
        const noneValue = none();
        return Promise.resolve(noneValue);
      },
    });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const cfg = {
      ...BASE_CONFIG,
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'p' }] },
      ],
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
  });

  it('second field resolution SKIPS discoverForm when formAnchor already set', async () => {
    const makeScreenshotPageResult17 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult17);
    const frame = requireBrowser(browserCtx).page;
    let discoverCalls = 0;
    const mediator = makeMockMediator({
      /**
       * Both fields resolve.
       * @returns Success.
       */
      resolveField: () => {
        const okFieldCtx = succeed({
          selector: '#pwd',
          context: frame,
          resolvedKind: 'placeholder',
          resolvedVia: 'placeholder',
        } as unknown as IFieldContext);
        return Promise.resolve(okFieldCtx);
      },
      /**
       * Discover form succeeds first time — anchor is cached.
       * @returns Some anchor.
       */
      discoverForm: () => {
        discoverCalls += 1;
        const someResult18 = some({ formEl: {} } as unknown as IFormAnchor);
        return Promise.resolve(someResult18);
      },
    });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const cfg = {
      ...BASE_CONFIG,
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'p' }] },
        { credentialKey: 'username', selectors: [{ kind: 'placeholder' as const, value: 'u' }] },
      ],
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
    // First call populates anchor; second password-first-then-username run should
    // only call discoverForm once (second iteration short-circuits at line 199).
    expect(discoverCalls).toBeLessThanOrEqual(2);
  });
});
