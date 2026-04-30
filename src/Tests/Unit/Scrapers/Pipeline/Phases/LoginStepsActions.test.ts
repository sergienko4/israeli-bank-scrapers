/**
 * Unit tests for LoginSteps.ts — loginAction phase.
 * postLogin tests are in LoginStepsPostLogin.test.ts.
 * preLogin and error-detection tests are in LoginSteps.test.ts.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { createLoginPhase } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginSteps.js';
import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithLogin,
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

/** Minimal success IFieldContext for mediator mock return. */
const SUCCESS_FIELD_CTX: IFieldContext = {
  isResolved: true,
  selector: '#field',
  context: makeMockFullPage() as unknown as Page,
  resolvedVia: 'wellKnown',
  round: 'mainPage',
};

/** Minimal found IRaceResult for resolveAndClick mock return. */
const MOCK_RACE_FOUND: IRaceResult = {
  found: true,
  locator: false,
  candidate: false,
  context: false,
  index: 0,
  value: '',
  identity: false,
};

// ── loginAction ───────────────────────────────────────────

describe('LoginSteps/loginAction', () => {
  it('fails when loginAreaReady gate is false', async () => {
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ mediator: mediatorSome, loginAreaReady: false });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('loginAreaReady=false');
  });

  it('fails when login context is absent (past gate)', async () => {
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const ctx = makeMockContext({ mediator: mediatorSome, loginAreaReady: true });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('no login state');
  });

  it('fails when mediator is absent from context (past gate)', async () => {
    const page = makeMockFullPage();
    const loginState = makeMockLoginState(page);
    const loginSome = some(loginState);
    const ctx = makeMockContext({ login: loginSome, loginAreaReady: true });
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('No mediator');
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
       * @returns Succeed with race result.
       */
      resolveAndClick: () => {
        const r = succeed(MOCK_RACE_FOUND);
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
        const r = fail(ScraperErrorTypes.Generic, `field ${key} not found`);
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
    expect(result.success).toBe(false);
    expect(resolvedFields).toHaveLength(1);
  });

  it('calls mediator.resolveAndClick after all fields filled', async () => {
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
       * @returns Succeed with race result.
       */
      resolveAndClick: () => {
        isClickableCalled = true;
        const r = succeed(MOCK_RACE_FOUND);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG({ fields: [{ credentialKey: 'username', selectors: [] }] });
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
      resolveAndClick: () => {
        const r = fail(ScraperErrorTypes.Generic, 'submit not found');
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('submit not found');
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
       * @returns Succeed with race result.
       */
      resolveAndClick: () => {
        const r = succeed(MOCK_RACE_FOUND);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(true);
  });
});
