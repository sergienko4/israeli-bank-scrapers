import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { IStepResult } from '../../Common/LoginMiddleware.js';
import type { ILoginStepContext } from '../../Scrapers/Base/LoginSteps.js';

const MOCK_HANDLE_OTP_CONFIRM = jest.fn().mockResolvedValue('+972****100');
const MOCK_HANDLE_OTP_CODE = jest.fn().mockResolvedValue({ success: false });
const MOCK_FILL_INPUT = jest.fn().mockResolvedValue(undefined);
const MOCK_RESOLVE_FIELD_CONTEXT = jest.fn();
const MOCK_RESOLVE_FIELD_WITH_CACHE = jest.fn();
const MOCK_EXTRACT_CREDENTIAL_KEY = jest.fn((s: string) => s);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns mock logger
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
  }),
);

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  /**
   * Executes async actions sequentially, collecting results.
   * @param actions - Array of async factory functions.
   * @returns Array of resolved values.
   */
  runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  TimeoutError: Error,
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  fillInput: MOCK_FILL_INPUT,
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldContext: MOCK_RESOLVE_FIELD_CONTEXT,
  resolveFieldWithCache: MOCK_RESOLVE_FIELD_WITH_CACHE,
  candidateToCss: jest.fn((c: { value: string }) => c.value),
  extractCredentialKey: MOCK_EXTRACT_CREDENTIAL_KEY,
  tryInContext: jest.fn().mockResolvedValue(null),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpConfirm: MOCK_HANDLE_OTP_CONFIRM,
  handleOtpCode: MOCK_HANDLE_OTP_CODE,
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://example.com'),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const {
  stepOtpConfirm: STEP_OTP_CONFIRM,
  stepOtpCode: STEP_OTP_CODE,
  resolveField: RESOLVE_FIELD,
  fillOneInput: FILL_ONE_INPUT,
} = await import('../../Scrapers/Base/LoginSteps.js');

/**
 * Creates a minimal mock ILoginStepContext for testing.
 * @param overrides - Optional partial overrides for the context.
 * @returns A mock login step context.
 */
function makeStepCtx(overrides: Partial<ILoginStepContext> = {}): ILoginStepContext {
  const page = {
    url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    frames: jest.fn().mockReturnValue([]),
    mainFrame: jest.fn().mockReturnValue(null),
  } as Partial<Page> as Page;
  return {
    page,
    activeLoginContext: null,
    otpPhoneHint: '',
    diagState: { loginUrl: '', lastAction: '' },
    emitProgress: jest.fn().mockReturnValue(true),
    navigateTo: jest.fn().mockResolvedValue(true),
    fillInputs: jest.fn().mockResolvedValue(true),
    loginResultCtx: jest.fn().mockReturnValue({
      page,
      diagState: { lastAction: '' },
      emitProgress: jest.fn().mockReturnValue(true),
    }),
    options: {} as ILoginStepContext['options'],
    ...overrides,
  };
}

describe('stepOtpConfirm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores phone hint from handleOtpConfirm and continues', async () => {
    MOCK_HANDLE_OTP_CONFIRM.mockResolvedValue('+972****100');
    const ctx = makeStepCtx();
    const stepResult: IStepResult = await STEP_OTP_CONFIRM(ctx);
    expect(stepResult.shouldContinue).toBe(true);
    expect(ctx.otpPhoneHint).toBe('+972****100');
    expect(MOCK_HANDLE_OTP_CONFIRM).toHaveBeenCalledWith(ctx.page, undefined, undefined);
  });
});

describe('stepOtpCode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stops the chain with the OTP result', async () => {
    const otpResult = { success: false, errorType: 'INVALID_OTP' };
    MOCK_HANDLE_OTP_CODE.mockResolvedValue(otpResult);
    const ctx = makeStepCtx({ otpPhoneHint: '+972****100' });
    const stepResult: IStepResult = await STEP_OTP_CODE(ctx);
    expect(stepResult.shouldContinue).toBe(false);
    expect(stepResult.result).toEqual(otpResult);
    expect(MOCK_HANDLE_OTP_CODE).toHaveBeenCalledWith(ctx.page, ctx.options, '+972****100');
  });
});

describe('resolveField', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses resolveFieldContext when no parsedPage is cached', async () => {
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      isResolved: true,
      selector: '#user',
      context: {},
    });
    const ctx = makeStepCtx({ currentParsedPage: undefined });
    const fc = { credentialKey: 'username', selectors: [] };
    const fieldCtx = await RESOLVE_FIELD(ctx, ctx.page, fc);
    expect(fieldCtx.isResolved).toBe(true);
    expect(MOCK_RESOLVE_FIELD_CONTEXT).toHaveBeenCalled();
    expect(MOCK_RESOLVE_FIELD_WITH_CACHE).not.toHaveBeenCalled();
  });

  it('uses resolveFieldWithCache when parsedPage is cached', async () => {
    MOCK_RESOLVE_FIELD_WITH_CACHE.mockResolvedValue({
      isResolved: true,
      selector: '#user',
      context: {},
    });
    const parsedPage = {
      childFrames: [],
      loginFormContext: null,
      pageUrl: 'https://bank.co.il',
      bodyText: '',
    };
    const ctx = makeStepCtx({ currentParsedPage: parsedPage });
    const fc = { credentialKey: 'username', selectors: [] };
    const fieldCtx = await RESOLVE_FIELD(ctx, ctx.page, fc);
    expect(fieldCtx.isResolved).toBe(true);
    expect(MOCK_RESOLVE_FIELD_WITH_CACHE).toHaveBeenCalled();
    expect(MOCK_RESOLVE_FIELD_CONTEXT).not.toHaveBeenCalled();
  });
});

describe('fillOneInput', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fills via resolved selector when field is resolved', async () => {
    const resolvedCtx = {} as Page;
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      isResolved: true,
      selector: '#resolved-user',
      context: resolvedCtx,
    });
    const ctx = makeStepCtx();
    const field = { selector: '#user', value: 'testuser', credentialKey: 'username' };
    const didFill = await FILL_ONE_INPUT(ctx, ctx.page, field);
    expect(didFill).toBe(true);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledWith(resolvedCtx, '#resolved-user', 'testuser');
    expect(ctx.activeLoginContext).toBe(resolvedCtx);
  });

  it('falls back to original selector when field is not resolved', async () => {
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      isResolved: false,
      selector: '',
      context: null,
    });
    const ctx = makeStepCtx();
    const field = { selector: '#fallback-input', value: 'val' };
    const didFill = await FILL_ONE_INPUT(ctx, ctx.page, field);
    expect(didFill).toBe(true);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledWith(ctx.page, '#fallback-input', 'val');
  });

  it('uses activeLoginContext as fallback when set and field not resolved', async () => {
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      isResolved: false,
      selector: '',
      context: null,
    });
    const activeCtx = { name: 'login-frame' } as unknown as Frame;
    const ctx = makeStepCtx({ activeLoginContext: activeCtx });
    const field = { selector: '#input', value: 'data' };
    await FILL_ONE_INPUT(ctx, ctx.page, field);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledWith(activeCtx, '#input', 'data');
  });
});
