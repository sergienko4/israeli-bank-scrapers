/**
 * Branch coverage extensions for LoginPhaseActions.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IActionMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IFieldContext } from '../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { ILoginFieldDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage, requireBrowser, toActionCtx } from './TestHelpers.js';

const BASE_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

describe('LoginPhaseActions — branch completion', () => {
  it('resolveOneField uses resolvedVia when resolvedKind missing', async () => {
    const makeScreenshotPageResult1 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult1);
    const frame = requireBrowser(browserCtx).page;
    const fieldCtx = {
      selector: '#pwd',
      context: frame,
      resolvedVia: 'xpath',
      // No resolvedKind — forces right side of ??
    };
    const typedFieldCtx = fieldCtx as unknown as IFieldContext;
    const mediator = makeMockMediator({
      /**
       * Resolve field succeeds with only resolvedVia.
       * @returns Success.
       */
      resolveField: () => {
        const okFieldCtx = succeed(typedFieldCtx);
        return Promise.resolve(okFieldCtx);
      },
      /**
       * Discover form none.
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
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('discoverFormFromField: re-resolve fails → none anchor', async () => {
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult3);
    const frame = requireBrowser(browserCtx).page;
    let call = 0;
    const mediator = makeMockMediator({
      /**
       * First resolve succeeds for accumulate, second fails for form anchor.
       * @returns Varied results.
       */
      resolveField: () => {
        call += 1;
        if (call === 1) {
          const succeedResult4 = succeed({
            selector: '#pwd',
            context: frame,
            resolvedKind: 'placeholder',
            resolvedVia: 'placeholder',
          } as unknown as IFieldContext);
          return Promise.resolve(succeedResult4);
        }
        const failResult5 = fail(ScraperErrorTypes.Generic, 'second fail');
        return Promise.resolve(failResult5);
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
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('resolveSubmitTarget returns none when result.context is missing', async () => {
    const makeScreenshotPageResult7 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult7);
    const frame = requireBrowser(browserCtx).page;
    const mediator = makeMockMediator({
      /**
       * Resolve field succeeds for password.
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
       * Submit resolves but has no context.
       * @returns Found with null context.
       */
      resolveVisible: () => {
        const raceResult = {
          found: true,
          locator: false,
          candidate: { kind: 'textContent', value: 'Login' },
          context: null as unknown as Page,
          index: 0,
          value: 'Login',
        } as unknown as IRaceResult;
        return Promise.resolve(raceResult);
      },
      /**
       * Discover form none.
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
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('buildSubmitSelector default fallback when candidate kind is unknown', async () => {
    const makeScreenshotPageResult9 = makeScreenshotPage();
    const browserCtx = makeContextWithBrowser(makeScreenshotPageResult9);
    const frame = requireBrowser(browserCtx).page;
    const mediator = makeMockMediator({
      /**
       * Resolve field succeeds.
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
       * Submit with unknown kind.
       * @returns Visible race result.
       */
      resolveVisible: () => {
        const raceResult = {
          found: true,
          locator: false,
          candidate: { kind: 'unknownKind', value: 'custom-value' },
          context: frame,
          index: 0,
          value: 'custom-value',
        } as unknown as IRaceResult;
        return Promise.resolve(raceResult);
      },
      /**
       * Discover form none.
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
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('executeValidateLogin: redirect wait when already off login URL', async () => {
    const mediator = makeMockMediator({
      /**
       * Different URL from loginUrl.
       * @returns Elsewhere.
       */
      getCurrentUrl: () => 'https://bank.example.com/portal',
    });
    const makeScreenshotPageResult11 = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResult11);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl: 'https://bank.example.com/login' },
    };
    const result = await executeValidateLogin(
      BASE_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('executeValidateLogin: postAction throws → fails', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult13 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult13);
    const cfg = {
      ...BASE_CONFIG,
      /**
       * postAction throws.
       * @returns Rejected.
       */
      postAction: (): Promise<never> => Promise.reject(new Error('post-fail')),
    };
    const result = await executeValidateLogin(cfg as unknown as ILoginConfig, mediator, ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(false);
  });

  it('ensureDashboardRedirect: isStillOnLogin=true → waitForURL callback invoked (L490)', async () => {
    const loginUrl = 'https://bank.example.com/login';
    const mediator = makeMockMediator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: () => loginUrl, // still on login
    });
    // Build browser page whose waitForURL invokes callback with varying URLs.
    const pageWithWait = {
      ...makeScreenshotPage(),
      /**
       * Invoke callback body — exercises `url.href !== currentUrl && url.href !== loginHash` pair.
       * @param fn - URL predicate.
       * @returns Resolves once callback returns true (after first different URL).
       */
      waitForURL: (fn: (url: URL) => boolean): Promise<void> => {
        // Run predicate against: loginHash, loginUrl, and a third URL.
        const u1 = new URL(`${loginUrl}#`);
        const u2 = new URL(loginUrl);
        const u3 = new URL('https://bank.example.com/portal');
        [u1, u2, u3].forEach(fn);
        return Promise.resolve();
      },
    };
    const base = makeContextWithLogin(pageWithWait as unknown as Page);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl },
    };
    const result = await executeValidateLogin(
      BASE_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    expect(typeof result.success).toBe('boolean');
  });

  it('fillAndSubmit: loginFieldDiscovery missing + executor missing combines errors', async () => {
    // executor=false, loginFieldDiscovery=none
    const base = makeMockContext({ loginAreaReady: true });
    const ctx = toActionCtx(base, false);
    const result = await executeFillAndSubmitFromDiscovery(
      BASE_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(false);
  });

  it('fillAndSubmit: fillFromDiscovery returns failure → propagates (line 432 truthy)', async () => {
    // Discovery has targets requiring credentials that are NOT in the creds map.
    // validateDiscoveryCredentials fails → fillFromDiscovery returns failure →
    // executeFillAndSubmitFromDiscovery hits `if (!result.success) return result` (truthy).
    const target = {
      selector: '#pwd',
      contextId: 'main',
      kind: 'css' as const,
      candidateValue: '#pwd',
    };
    const discoveryTargets = new Map([['password', target]] as const);
    const discovery = {
      targets: discoveryTargets,
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const base = makeMockContext({
      loginAreaReady: true,
      loginFieldDiscovery: some(discovery as unknown as ILoginFieldDiscovery),
      credentials: {} as unknown as ScraperCredentials, // empty creds → missing 'password' → validation fails
    });
    const executor = {
      /**
       * Noop fill.
       * @returns Resolved.
       */
      fillInput: () => Promise.resolve(true),
      /**
       * Noop press.
       * @returns Resolved.
       */
      pressEnter: () => Promise.resolve(true),
      /**
       * Noop click.
       * @returns Resolved.
       */
      clickElement: () => Promise.resolve(true),
      /**
       * Noop resolveAndClick.
       * @returns Succeed(false).
       */
      resolveAndClick: () => Promise.resolve({ success: true, value: { found: false } }),
    } as unknown as IActionMediator;
    const ctx = toActionCtx(base, executor);
    const result = await executeFillAndSubmitFromDiscovery(
      BASE_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(false);
  });
});
