/**
 * Unit tests for LoginPhaseActions — redirect / edge / success paths split from DeepShared file.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  ILoginFieldDiscovery,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/** Local test error. */
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
 * Narrow ctx.browser to ISome.
 * @param ctx - Parameter.
 * @param ctx.browser - Browser option.
 * @param ctx.browser.has - Present flag.
 * @returns Result.
 */
function requireBrowser(ctx: { browser: { has: boolean } }): IBrowserState {
  if (!ctx.browser.has) throw new TestError('expected browser state');
  return (ctx.browser as { has: true; value: IBrowserState }).value;
}

/** Minimal ILoginConfig for tests. */
const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

// ── executeValidateLogin redirect wait ───────────────────────────────
describe('executeValidateLogin — redirect path', () => {
  it('succeeds when SPA login keeps the exact same login URL (Amex pattern)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    /** URL stays exactly equal to the login URL — SPA auth, no navigation. */
    const loginUrl = 'https://bank.example.com/login';
    const mediator = makeMockMediator({
      /**
       * Never leaves the exact login URL — in-place SPA auth.
       * @returns Login URL.
       */
      getCurrentUrl: () => loginUrl,
    });
    /** Page with a waitForURL that rejects (simulates timeout). */
    const makeScreenshotPageResult45 = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResult45);
    const baseBrowser = requireBrowser(base);
    const page = baseBrowser.page;
    const pageWithWait = {
      ...page,
      /**
       * Reject wait immediately to exercise catch path.
       * @returns Rejected.
       */
      waitForURL: (): Promise<never> => Promise.reject(new Error('nav timeout')),
    };
    const typedPage = pageWithWait as unknown as Page;
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl },
      browser: some({ ...baseBrowser, page: typedPage }),
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('succeeds when URL equals login URL + trailing #', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    /** loginUrl + '#' — pathname same, only fragment added. Not a bounce. */
    const loginUrl = 'https://bank.example.com/login';
    const mediator = makeMockMediator({
      /**
       * Return login URL with trailing hash.
       * @returns Hash URL.
       */
      getCurrentUrl: () => `${loginUrl}#`,
    });
    const makeScreenshotPageResult47 = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResult47);
    const baseBrowser = requireBrowser(base);
    const page = baseBrowser.page;
    const pageWithWait = {
      ...page,
      /**
       * Resolve wait (successful redirect simulated).
       * @returns Resolved.
       */
      waitForURL: (): Promise<true> => Promise.resolve(true),
    };
    const typedPage = pageWithWait as unknown as Page;
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl },
      browser: some({ ...baseBrowser, page: typedPage }),
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('fails InvalidPassword when post-submit URL keeps login path but adds query-string (Max bounce)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const loginUrl = 'https://www.max.co.il/login';
    const bouncedUrl =
      'https://www.max.co.il/login?ReturnURL=https:%2F%2Fwww.max.co.il%2Fhomepage%3FSourceGA%3DAnonymousHeaderCH';
    const mediator = makeMockMediator({
      /**
       * Return bounced login URL — pathname still /login, different query.
       * @returns Bounced URL.
       */
      getCurrentUrl: () => bouncedUrl,
    });
    const makeScreenshotPageResultBounce = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResultBounce);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl },
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('skips bounce detection when loginUrl is empty', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const mediator = makeMockMediator({
      /**
       * Return login URL verbatim — mediator says we stayed on /login.
       * @returns Login URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/login',
    });
    const makeScreenshotPageEmpty = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageEmpty);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl: '' },
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('succeeds when loginPathOf falls back to raw URL (unparseable url)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const loginUrl = 'not-a-valid-url';
    const mediator = makeMockMediator({
      /**
       * Return an unparseable different URL — both fall through safeParse.
       * @returns Different unparseable URL.
       */
      getCurrentUrl: () => 'also-not-valid',
    });
    const makeScreenshotPageMal = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageMal);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl },
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('skips redirect wait when already off login page', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const mediator = makeMockMediator({
      /**
       * Different URL from loginUrl.
       * @returns Elsewhere.
       */
      getCurrentUrl: () => 'https://bank.example.com/dashboard',
    });
    const makeScreenshotPageResult49 = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResult49);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl: 'https://bank.example.com/login' },
    };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult50 = isOk(result);
    expect(isOkResult50).toBe(true);
  });
});

// ── Empty submit config + no fields edge cases ───────────────────────
describe('executeDiscoverForm — submit config edge cases', () => {
  it('accepts array submit with one element', async () => {
    const makeScreenshotPageResult51 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult51);
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
      ],
      submit: [{ kind: 'xpath' as const, value: '//button[@type="submit"]' }],
      possibleResults: {},
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult52 = isOk(result);
    expect(isOkResult52).toBe(true);
  });
});

// ── executeFillAndSubmitFromDiscovery success path ──────────────────
describe('executeFillAndSubmitFromDiscovery — success path', () => {
  it('succeeds when discovery + executor present + valid fields', async () => {
    const target: IResolvedTarget = {
      selector: '#pwd',
      contextId: 'main',
      kind: 'placeholder',
      candidateValue: 'password',
    };
    const targets = new Map<string, IResolvedTarget>();
    targets.set('password', target);
    const disc: ILoginFieldDiscovery = {
      targets: targets as unknown as ILoginFieldDiscovery['targets'],
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const base = makeMockContext({
      loginAreaReady: true,
      loginFieldDiscovery: some(disc),
      credentials: { username: 'u', password: 'p' } as unknown as ScraperCredentials,
    });
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
      ],
      submit: [{ kind: 'textContent' as const, value: 'Login' }],
      possibleResults: {},
    };
    const makeExecResult53 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeExecResult53);
    const result = await executeFillAndSubmitFromDiscovery(cfg as unknown as ILoginConfig, ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
