/**
 * Unit tests for LoginSteps.ts — postLogin phase.
 * loginAction tests are in LoginStepsActions.test.ts.
 */

import type { LifecyclePromise } from '../../../../../Scrapers/Base/Interfaces/CallbackTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { createLoginPhase } from '../../../../../Scrapers/Pipeline/Phases/Login/LoginSteps.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
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
const MAKE_LOGIN_CONFIG = (overrides: Partial<ILoginConfig> = {}): ILoginConfig => ({
  loginUrl: 'https://bank.test/login',
  fields: [],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  possibleResults: { success: [] },
  ...overrides,
});

/**
 * Build a full postLogin context with browser + login + mediator.
 * @param mediatorOverrides - Optional mediator method overrides.
 * @returns Context with all three as some().
 */
const MAKE_POST_LOGIN_CTX = (
  mediatorOverrides: Partial<IElementMediator> = {},
): IPipelineContext => {
  const page = makeMockFullPage();
  const browserState = makeMockBrowserState(page);
  const loginState = makeMockLoginState(page);
  const mediator = makeMockMediator(mediatorOverrides);
  const browserSome = some(browserState);
  const loginSome = some(loginState);
  const mediatorSome = some(mediator);
  return makeMockContext({ browser: browserSome, login: loginSome, mediator: mediatorSome });
};

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
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('No browser');
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
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('No login state');
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
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('No mediator');
  });

  it('fails with InvalidPassword when discoverErrors finds errors', async () => {
    const ctx = MAKE_POST_LOGIN_CTX({
      /**
       * Return form error.
       * @returns Error scan result.
       */
      discoverErrors: () =>
        Promise.resolve({ hasErrors: true, errors: [], summary: 'פרטים שגויים' }),
    });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('INVALID_PASSWORD');
      expect(result.errorMessage).toContain('פרטים שגויים');
    }
  });

  it('calls postAction when no errors detected', async () => {
    const postActionCalled: boolean[] = [];
    const ctx = MAKE_POST_LOGIN_CTX({
      /**
       * Return no errors.
       * @returns No-errors scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: false, errors: [], summary: '' }),
    });
    const config = MAKE_LOGIN_CONFIG({
      /**
       * Mock postAction — tracks calls.
       * @returns Resolved.
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
    const postActionCalled: boolean[] = [];
    const ctx = MAKE_POST_LOGIN_CTX({
      /**
       * Return form error.
       * @returns Error scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: true, errors: [], summary: 'error' }),
    });
    const config = MAKE_LOGIN_CONFIG({
      /**
       * Mock postAction — should NOT be called.
       * @returns Resolved.
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
    const ctx = MAKE_POST_LOGIN_CTX({
      /**
       * Return no errors.
       * @returns No-errors scan result.
       */
      discoverErrors: () => Promise.resolve({ hasErrors: false, errors: [], summary: '' }),
    });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.post.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });
});
