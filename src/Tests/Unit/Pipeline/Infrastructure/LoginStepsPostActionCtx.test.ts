/**
 * Unit tests for LoginSteps postLogin with postActionWithCtx.
 * Tests that postActionWithCtx receives the full pipeline context (credentials, mediator).
 * Tests that postActionWithCtx is preferred over postAction when both are present.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NO_ERRORS } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import { createPostLoginStep } from '../../../../Scrapers/Pipeline/Phases/Login/LoginSteps.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  ILoginState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { IPipelineLoginConfig } from '../../../../Scrapers/Pipeline/Types/PipelineLoginConfig.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeMockPage } from './MockFactories.js';

// ── Mock helpers ───────────────────────────────────────────

/**
 * Build a mock mediator that reports no errors and no loading.
 * @returns IElementMediator stub with all methods implemented.
 */
function makeMockMediator(): IElementMediator {
  const mediator: IElementMediator = {
    /**
     * Stub resolveField.
     * @returns Rejected — not used in postLogin tests.
     */
    resolveField: (): Promise<never> => Promise.reject(new Error('not called')),
    /**
     * Stub resolveClickable.
     * @returns Rejected — not used in postLogin tests.
     */
    resolveClickable: (): Promise<never> => Promise.reject(new Error('not called')),
    /**
     * Return no errors — simulates successful login.
     * @returns Resolved with NO_ERRORS.
     */
    discoverErrors: (): Promise<typeof NO_ERRORS> => Promise.resolve(NO_ERRORS),
    /**
     * Loading already done.
     * @returns Succeed(true) — loading complete.
     */
    waitForLoadingDone: () => {
      const done = succeed(true as const);
      return Promise.resolve(done);
    },
    /**
     * Stub discoverForm.
     * @returns Rejected — not used in postLogin tests.
     */
    discoverForm: (): Promise<never> => Promise.reject(new Error('not called')),
    /**
     * Resolve and click — returns succeed(NOT_FOUND_RESULT) by default.
     * @returns Succeed with NOT_FOUND_RESULT.
     */
    resolveAndClick: () => {
      const notFound = succeed(NOT_FOUND_RESULT);
      return Promise.resolve(notFound);
    },
    /**
     * Resolve visible — returns NOT_FOUND_RESULT.
     * @returns NOT_FOUND_RESULT.
     */
    resolveVisible: () => Promise.resolve(NOT_FOUND_RESULT),
    /**
     * Stub scopeToForm — passthrough.
     * @param c - Candidates.
     * @returns Same candidates.
     */
    scopeToForm: (c: readonly SelectorCandidate[]): readonly SelectorCandidate[] => c,
    /**
     * Navigation mock — always succeeds.
     * @returns Succeed(undefined).
     */
    navigateTo: (): Promise<Procedure<void>> => {
      const done = succeed(undefined);
      return Promise.resolve(done);
    },
    /**
     * URL mock — returns about:blank.
     * @returns Mock URL.
     */
    getCurrentUrl: (): string => 'about:blank',
    /**
     * Network idle mock — always succeeds.
     * @returns Succeed(undefined).
     */
    waitForNetworkIdle: (): Promise<Procedure<void>> => {
      const done = succeed(undefined);
      return Promise.resolve(done);
    },
    /**
     * Count by text mock — returns 0.
     * @returns Zero.
     */
    countByText: (): Promise<number> => Promise.resolve(0),
    /**
     * No DOM in mock — empty hrefs.
     * @returns Empty array.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
    /**
     * No cookies in mock.
     * @returns Empty array.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve([]),
    /**
     * No-op cookie injection in mock.
     * @returns Resolved.
     */
    addCookies: (): Promise<void> => Promise.resolve(),
    network: {
      /**
       * No endpoints in mock.
       * @returns Empty array.
       */
      findEndpoints: (): readonly [] => [],
      /**
       * No services URL in mock.
       * @returns False.
       */
      getServicesUrl: (): false => false,
      /**
       * No endpoints in mock.
       * @returns Empty array.
       */
      getAllEndpoints: (): readonly [] => [],
      /**
       * No patterns discovered in mock.
       * @returns False.
       */
      discoverByPatterns: (): false => false,
      /**
       * No SPA URL in mock.
       * @returns False.
       */
      discoverSpaUrl: (): false => false,
      /**
       * No accounts in mock.
       * @returns False.
       */
      discoverAccountsEndpoint: (): false => false,
      /**
       * No transactions in mock.
       * @returns False.
       */
      discoverTransactionsEndpoint: (): false => false,
      /**
       * No balance in mock.
       * @returns False.
       */
      discoverBalanceEndpoint: (): false => false,
      /**
       * No auth token in mock.
       * @returns False.
       */
      discoverAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No origin in mock.
       * @returns False.
       */
      discoverOrigin: (): false => false,
      /**
       * No site ID in mock.
       * @returns False.
       */
      discoverSiteId: (): false => false,
      /**
       * Empty headers in mock.
       * @returns Default empty opts.
       */
      buildDiscoveredHeaders: (): Promise<{ extraHeaders: Record<string, string> }> =>
        Promise.resolve({ extraHeaders: {} }),
      /**
       * No transaction URL in mock.
       * @returns False.
       */
      buildTransactionUrl: (): false => false,
      /**
       * No balance URL in mock.
       * @returns False.
       */
      buildBalanceUrl: (): false => false,
      /**
       * No traffic in mock.
       * @returns False.
       */
      waitForTraffic: (): Promise<false> => Promise.resolve(false),
      /**
       * No auth cache in mock.
       * @returns False.
       */
      cacheAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No API origin in mock.
       * @returns False.
       */
      discoverApiOrigin: (): false => false,
      /**
       * No content match in mock.
       * @returns False.
       */
      discoverEndpointByContent: (): false => false,
    },
  };
  return mediator;
}

/**
 * Build a mock browser state with a page.
 * @param page - Mock Playwright page.
 * @returns IBrowserState for test context.
 */
function makeMockBrowserState(page: Page): IBrowserState {
  const state: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  return state;
}

/**
 * Build a mock login state with a page as active frame.
 * @param page - Mock Playwright page.
 * @returns ILoginState for test context.
 */
function makeMockLoginState(page: Page): ILoginState {
  const state: ILoginState = {
    activeFrame: page as unknown as Page | Frame,
    persistentOtpToken: none(),
  };
  return state;
}

/**
 * Build a mock page with waitForLoadState support.
 * @returns Mock Page suitable for postLogin step execution.
 */
function makeSettlablePage(): Page {
  const basePage = makeMockPage();
  const page = {
    ...basePage,
    /**
     * Simulate fast networkidle.
     * @returns Resolved true.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Simulate URL change after login.
     * @returns Resolved (URL changed).
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
  return page;
}

/**
 * Build a mock context with browser, login, and mediator populated.
 * @param overrides - Optional context field overrides.
 * @returns IPipelineContext ready for postLogin step execution.
 */
function makePostLoginContext(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  const mockPage = makeSettlablePage();
  const browserState = makeMockBrowserState(mockPage);
  const loginState = makeMockLoginState(mockPage);
  const mediator = makeMockMediator();
  const ctx = makeMockContext({
    browser: some(browserState),
    login: some(loginState),
    mediator: some(mediator),
    ...overrides,
  });
  return ctx;
}

// ── Tests ──────────────────────────────────────────────────

describe('createPostLoginStep with postActionWithCtx', () => {
  it('calls postActionWithCtx with page and full pipeline context', async () => {
    let hasReceivedCtx = false;
    let capturedId = '';

    /**
     * Capture credentials from pipeline context.
     * @param _page - Browser page (unused in capture).
     * @param ctx - Full pipeline context.
     * @returns True after capturing.
     */
    const captureCtx = (_page: Page, ctx: IPipelineContext): Promise<boolean> => {
      hasReceivedCtx = true;
      const creds = ctx.credentials as Record<string, string>;
      capturedId = creds.id;
      return Promise.resolve(true);
    };

    const config = {
      loginUrl: 'https://max.co.il',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: captureCtx,
    } as unknown as IPipelineLoginConfig;

    const ctx = makePostLoginContext({
      credentials: { username: 'maxUser', password: 'maxP', id: '111222333' },
    });
    const step = createPostLoginStep(config);
    const result = await step.execute(ctx, ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    expect(hasReceivedCtx).toBe(true);
    expect(capturedId).toBe('111222333');
  });

  it('prefers postActionWithCtx over postAction when both present', async () => {
    let isPostActionCalled = false;
    let isPostActionWithCtxCalled = false;

    /**
     * Stub postAction — should NOT be called.
     * @returns True.
     */
    const stubPostAction = (): Promise<boolean> => {
      isPostActionCalled = true;
      return Promise.resolve(true);
    };
    /**
     * Stub postActionWithCtx — should be called.
     * @returns True.
     */
    const stubPostActionWithCtx = (): Promise<boolean> => {
      isPostActionWithCtxCalled = true;
      return Promise.resolve(true);
    };

    const config = {
      loginUrl: 'https://max.co.il',
      fields: [],
      submit: [],
      possibleResults: {},
      postAction: stubPostAction,
      postActionWithCtx: stubPostActionWithCtx,
    } as unknown as IPipelineLoginConfig;

    const ctx = makePostLoginContext();
    const step = createPostLoginStep(config);
    await step.execute(ctx, ctx);

    expect(isPostActionWithCtxCalled).toBe(true);
    expect(isPostActionCalled).toBe(false);
  });

  it('falls back to postAction when postActionWithCtx is absent', async () => {
    let isPostActionCalled = false;

    /**
     * Stub postAction — should be called as fallback.
     * @returns True.
     */
    const stubPostAction = (): Promise<boolean> => {
      isPostActionCalled = true;
      return Promise.resolve(true);
    };

    const config = {
      loginUrl: 'https://discount.co.il',
      fields: [],
      submit: [],
      possibleResults: {},
      postAction: stubPostAction,
    } as unknown as ILoginConfig;

    const ctx = makePostLoginContext();
    const step = createPostLoginStep(config);
    await step.execute(ctx, ctx);

    expect(isPostActionCalled).toBe(true);
  });

  it('succeeds when neither postAction nor postActionWithCtx is present', async () => {
    const config = {
      loginUrl: 'https://bank.co.il',
      fields: [],
      submit: [],
      possibleResults: {},
    } as unknown as ILoginConfig;

    const ctx = makePostLoginContext();
    const step = createPostLoginStep(config);
    const result = await step.execute(ctx, ctx);
    const isSuccess = isOk(result);

    expect(isSuccess).toBe(true);
  });

  it('returns failure when postActionWithCtx throws', async () => {
    /**
     * Stub that throws to simulate ID form detection failure.
     * @returns Never — always throws.
     */
    const throwingStub = (): Promise<never> =>
      Promise.reject(new Error('ID form detection failed'));

    const config = {
      loginUrl: 'https://max.co.il',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: throwingStub,
    } as unknown as IPipelineLoginConfig;

    const ctx = makePostLoginContext();
    const step = createPostLoginStep(config);
    const result = await step.execute(ctx, ctx);
    const isSuccess = isOk(result);

    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ID form detection failed');
    }
  });
});
