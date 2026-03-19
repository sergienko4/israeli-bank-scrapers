/**
 * Unit tests for LoginSteps.ts — loginAction and postLogin phases.
 * preLogin and error-detection tests are in LoginSteps.test.ts.
 */

import type { IFieldContext } from '../../../../../Common/SelectorResolverPipeline.js';
import type { LifecyclePromise } from '../../../../../Scrapers/Base/Interfaces/CallbackTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { createLoginPhase } from '../../../../../Scrapers/Pipeline/Phases/LoginSteps.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithLogin,
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockLoginState,
  makeMockMediator,
} from '../MockPipelineFactories.js';

// ── Helper factories ───────────────────────────────────────

/**
 * Create a minimal ILoginConfig stub.
 * @param overrides - Optional field overrides.
 * @returns Minimal ILoginConfig.
 */
const MAKE_LOGIN_CONFIG = (overrides: Partial<ILoginConfig> = {}): ILoginConfig =>
  ({
    loginUrl: 'https://bank.test/login',
    fields: [],
    submit: [{ kind: 'textContent', value: 'כניסה' }],
    possibleResults: {},
    ...overrides,
  }) as never;

/** Minimal success IFieldContext for mediator mock return. */
const SUCCESS_FIELD_CTX: IFieldContext = {
  isResolved: true,
  selector: '#field',
  context: makeMockFullPage() as never,
  resolvedVia: 'wellKnown',
  round: 'mainPage',
};

// ── loginAction ───────────────────────────────────────────

describe('LoginSteps/loginAction', () => {
  it('fails when login context is absent', async () => {
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('No login context');
  });

  it('fails when mediator is absent from context', async () => {
    const page = makeMockFullPage();
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const ctx = makeMockContext({ login: loginSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('No mediator');
  });

  it('calls mediator.resolveField for each field', async () => {
    const resolvedFields: string[] = [];
    const mockCtx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Track resolved field keys.
       * @param key - Field key.
       * @returns Succeed with field context.
       */
      resolveField: (key: string) => {
        resolvedFields.push(key);
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
      /**
       * Return success for submit.
       * @returns Succeed with field context.
       */
      resolveClickable: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const ctx = { ...mockCtx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG({
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
    });
    const phase = createLoginPhase(config);
    await phase.action.execute(ctx, ctx);
    expect(resolvedFields).toContain('username');
    expect(resolvedFields).toContain('password');
  });

  it('propagates field-not-found failure and stops filling', async () => {
    const resolvedFields: string[] = [];
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Track key and return fail.
       * @param key - Field key.
       * @returns Fail procedure.
       */
      resolveField: (key: string) => {
        resolvedFields.push(key);
        const r = fail('GENERIC' as never, `field ${key} not found`);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG({
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
    });
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.ok).toBe(false);
    expect(resolvedFields).toHaveLength(1);
  });

  it('calls mediator.resolveClickable after all fields filled', async () => {
    let isClickableCalled = false;
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Succeed immediately.
       * @returns Succeed with field context.
       */
      resolveField: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
      /**
       * Track clickable call.
       * @returns Succeed with field context.
       */
      resolveClickable: () => {
        isClickableCalled = true;
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG({ fields: [{ credentialKey: 'id', selectors: [] }] });
    const phase = createLoginPhase(config);
    await phase.action.execute(withMediator, withMediator);
    expect(isClickableCalled).toBe(true);
  });

  it('propagates submit-not-found failure', async () => {
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Succeed for fields.
       * @returns Succeed with field context.
       */
      resolveField: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
      /**
       * Fail for submit.
       * @returns Fail procedure.
       */
      resolveClickable: () => {
        const r = fail('GENERIC' as never, 'submit not found');
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toBe('submit not found');
  });

  it('returns succeed(input) when all fields filled and submit clicked', async () => {
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Succeed for fields.
       * @returns Succeed with field context.
       */
      resolveField: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
      /**
       * Succeed for submit.
       * @returns Succeed with field context.
       */
      resolveClickable: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.ok).toBe(true);
  });
});

// ── postLogin ─────────────────────────────────────────────

describe('LoginSteps/postLogin', () => {
  it('fails when browser is absent', async () => {
    const page = makeMockFullPage();
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ login: loginSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('No browser');
  });

  it('fails when login state is absent', async () => {
    const page = makeMockFullPage();
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ browser: browserSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('No login state');
  });

  it('fails when mediator is absent', async () => {
    const page = makeMockFullPage();
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const ctx = makeMockContext({ browser: browserSome, login: loginSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('No mediator');
  });

  it('fails with InvalidPassword when discoverErrors finds errors', async () => {
    const page = makeMockFullPage();
    const mediator = makeMockMediator({
      /**
       * Return form error.
       * @returns Error scan result.
       */
      discoverErrors: () =>
        Promise.resolve({ hasErrors: true, errors: [], summary: 'פרטים שגויים' }),
    });
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ browser: browserSome, login: loginSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('INVALID_PASSWORD');
      expect(result.errorMessage).toContain('פרטים שגויים');
    }
  });

  it('calls postAction when no errors detected', async () => {
    const page = makeMockFullPage();
    const postActionCalled: boolean[] = [];
    const mediator = makeMockMediator({
      /**
       * Return no errors.
       * @returns No-errors scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: false, errors: [], summary: '' }),
    });
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ browser: browserSome, login: loginSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG({
      /**
       * Mock postAction — tracks calls.
       * @returns True.
       */
      postAction: (): LifecyclePromise => {
        postActionCalled.push(true);
        return Promise.resolve();
      },
    });
    const phase = createLoginPhase(config);
    await phase.post.execute(ctx, ctx);
    expect(postActionCalled).toHaveLength(1);
  });

  it('does NOT call postAction when errors detected', async () => {
    const page = makeMockFullPage();
    const postActionCalled: boolean[] = [];
    const mediator = makeMockMediator({
      /**
       * Return form error.
       * @returns Error scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: true, errors: [], summary: 'error' }),
    });
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ browser: browserSome, login: loginSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG({
      /**
       * Mock postAction — should NOT be called.
       * @returns True.
       */
      postAction: (): LifecyclePromise => {
        postActionCalled.push(true);
        return Promise.resolve();
      },
    });
    const phase = createLoginPhase(config);
    await phase.post.execute(ctx, ctx);
    expect(postActionCalled).toHaveLength(0);
  });

  it('returns succeed(input) when no errors detected', async () => {
    const page = makeMockFullPage();
    const mediator = makeMockMediator({
      /**
       * Return no errors.
       * @returns No-errors scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: false, errors: [], summary: '' }),
    });
    const browserState = makeMockBrowserState(page);
    const browserSome = some(browserState);
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ browser: browserSome, login: loginSome, mediator: mediatorSome });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.ok).toBe(true);
  });
});
