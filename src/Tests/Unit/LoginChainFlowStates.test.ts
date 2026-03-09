import { jest } from '@jest/globals';
import type { Page } from 'playwright';

import type { IStepResult, LoginStep } from '../../Common/LoginMiddleware.js';
import type { ILoginOptions } from '../../Scrapers/Base/BaseScraperHelpers.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { ILoginStepContext } from '../../Scrapers/Base/LoginSteps.js';

const MOCK_HANDLE_OTP_CODE = jest.fn().mockResolvedValue({ success: true });
const MOCK_WAIT_FOR_NAV = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Mock debug factory.
   * @returns A mock logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  /**
   * Sequential executor for async actions.
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
  fillInput: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));
jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldContext: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  candidateToCss: jest.fn((c: { value: string }) => c.value),
  extractCredentialKey: jest.fn((s: string) => s),
  tryInContext: jest.fn().mockResolvedValue(null),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));
jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpConfirm: jest.fn().mockResolvedValue('+972****100'),
  handleOtpCode: MOCK_HANDLE_OTP_CODE,
}));
jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: MOCK_WAIT_FOR_NAV,
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.co.il/dashboard'),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const STEPS = await import('../../Scrapers/Base/LoginSteps.js');
const MIDDLEWARE = await import('../../Common/LoginMiddleware.js');

/**
 * Creates a minimal mock ILoginStepContext.
 * @param overrides - Optional partial overrides.
 * @returns A mock login step context.
 */
function makeCtx(overrides: Partial<ILoginStepContext> = {}): ILoginStepContext {
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

/**
 * Creates minimal ILoginOptions.
 * @param overrides - Optional partial overrides.
 * @returns A mock login options object.
 */
function makeOpts(overrides: Partial<ILoginOptions> = {}): ILoginOptions {
  return {
    loginUrl: 'https://bank.co.il',
    fields: [],
    submitButtonSelector: '#submit',
    possibleResults: {},
    ...overrides,
  };
}

/** Flow-state validation for individual login chain steps and full chain. */
describe('stepNavigate — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('success: returns { shouldContinue: true }', async () => {
    const ctx = makeCtx();
    const opts = makeOpts();
    const result = await STEPS.stepNavigate(ctx, opts);
    expect(result).toEqual({ shouldContinue: true });
    expect(result).not.toHaveProperty('result');
  });
});

describe('stepFillAndSubmit — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('success: returns { shouldContinue: true }', async () => {
    const ctx = makeCtx();
    const opts = makeOpts();
    const loginCtx = { page: ctx.page, activeFrame: ctx.page, loginSetup: {} } as never;
    const result = await STEPS.stepFillAndSubmit(ctx, opts, loginCtx);
    expect(result).toEqual({ shouldContinue: true });
    expect(result).not.toHaveProperty('result');
  });
});

describe('stepCheckEarlyResult — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('no match: returns { shouldContinue: true }', async () => {
    const ctx = makeCtx();
    const opts = makeOpts();
    const result = await STEPS.stepCheckEarlyResult(ctx, opts);
    expect(result).toEqual(MIDDLEWARE.CONTINUE);
    expect(result).not.toHaveProperty('result');
  });
  it('match found: returns stop result with error', async () => {
    const ctx = makeCtx();
    const pageUrl = 'https://bank.co.il/login';
    (ctx.page.url as jest.Mock).mockReturnValue(pageUrl);
    const opts = makeOpts({ possibleResults: { INVALID_PASSWORD: [pageUrl] } });
    const result = await STEPS.stepCheckEarlyResult(ctx, opts);
    expect(result.shouldContinue).toBe(false);
    expect(result.result).toBeDefined();
    expect(result.result?.success).toBe(false);
    expect(result.result?.errorType).toBeDefined();
  });
});

describe('stepOtpCode — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('OTP success: returns { shouldContinue: true }', async () => {
    MOCK_HANDLE_OTP_CODE.mockResolvedValue({ success: true });
    const ctx = makeCtx({ otpPhoneHint: '****100' });
    const result = await STEPS.stepOtpCode(ctx);
    expect(result).toEqual({ shouldContinue: true });
    expect(result).not.toHaveProperty('result');
  });
  it('OTP failure: returns stop result with INVALID_OTP', async () => {
    const otpFail = {
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage: 'rejected',
    };
    MOCK_HANDLE_OTP_CODE.mockResolvedValue(otpFail);
    const ctx = makeCtx({ otpPhoneHint: '****100' });
    const result = await STEPS.stepOtpCode(ctx);
    expect(result.shouldContinue).toBe(false);
    expect(result.result).toEqual(otpFail);
    expect(result.result?.errorType).toBe(ScraperErrorTypes.InvalidOtp);
  });
});

describe('stepPostAction — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('with postAction: returns { shouldContinue: true }', async () => {
    const postAction = jest.fn().mockResolvedValue(true);
    const ctx = makeCtx();
    const opts = makeOpts({ postAction });
    const result = await STEPS.stepPostAction(ctx, opts);
    expect(result).toEqual({ shouldContinue: true });
    expect(postAction).toHaveBeenCalledTimes(1);
  });
  it('without postAction: returns { shouldContinue: true }', async () => {
    const ctx = makeCtx();
    const opts = makeOpts();
    const result = await STEPS.stepPostAction(ctx, opts);
    expect(result).toEqual({ shouldContinue: true });
    expect(MOCK_WAIT_FOR_NAV).toHaveBeenCalled();
  });
});

describe('stepWaitAfterSubmit — flow states', () => {
  beforeEach(() => jest.clearAllMocks());
  it('always returns { shouldContinue: true }', async () => {
    const ctx = makeCtx();
    const result = await STEPS.stepWaitAfterSubmit(ctx);
    expect(result).toEqual({ shouldContinue: true });
    expect(result).not.toHaveProperty('result');
  });
});

describe('Login Chain Runner — full chain flow states', () => {
  beforeEach(() => jest.clearAllMocks());

  it('all steps pass: returns null (chain completed)', async () => {
    /**
     * Passing step stub for chain tests.
     * @returns A continue result.
     */
    const pass: LoginStep = (): Promise<IStepResult> => Promise.resolve({ shouldContinue: true });
    const chainCtx = { page: {} as Page, activeFrame: {} as Page, loginSetup: {} } as never;
    const chainResult = await MIDDLEWARE.runLoginChain([pass, pass], chainCtx);
    expect(chainResult).toBeNull();
  });
  it('step fails: returns the failing step error result', async () => {
    const err = {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'wrong',
    };
    /**
     * Passing step stub.
     * @returns A continue result.
     */
    const pass: LoginStep = (): Promise<IStepResult> => Promise.resolve({ shouldContinue: true });
    /**
     * Failing step that stops the chain with a password error.
     * @returns A stop result with password error.
     */
    const fail: LoginStep = (): Promise<IStepResult> =>
      Promise.resolve({ shouldContinue: false, result: err });
    const neverReached: LoginStep = jest.fn().mockResolvedValue({ shouldContinue: true });
    const chainCtx = { page: {} as Page, activeFrame: {} as Page, loginSetup: {} } as never;
    const chainResult = await MIDDLEWARE.runLoginChain([pass, fail, neverReached], chainCtx);
    expect(chainResult).toEqual(err);
    expect(chainResult?.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(neverReached).not.toHaveBeenCalled();
  });
  it('first step fails: returns immediately', async () => {
    const err = { success: false, errorType: ScraperErrorTypes.Timeout, errorMessage: 'timeout' };
    /**
     * Failing first step that stops the chain with a timeout error.
     * @returns A stop result with timeout error.
     */
    const fail: LoginStep = (): Promise<IStepResult> =>
      Promise.resolve({ shouldContinue: false, result: err });
    const second: LoginStep = jest.fn().mockResolvedValue({ shouldContinue: true });
    const chainCtx = { page: {} as Page, activeFrame: {} as Page, loginSetup: {} } as never;
    const chainResult = await MIDDLEWARE.runLoginChain([fail, second], chainCtx);
    expect(chainResult).toEqual(err);
    expect(second).not.toHaveBeenCalled();
  });
  it('empty chain: returns null', async () => {
    const chainCtx = { page: {} as Page, activeFrame: {} as Page, loginSetup: {} } as never;
    const chainResult = await MIDDLEWARE.runLoginChain([], chainCtx);
    expect(chainResult).toBeNull();
  });
  it('OTP failure stops chain', async () => {
    const otpErr = { success: false, errorType: ScraperErrorTypes.InvalidOtp, errorMessage: 'otp' };
    /**
     * Passing step stub.
     * @returns A continue result.
     */
    const pass: LoginStep = (): Promise<IStepResult> => Promise.resolve({ shouldContinue: true });
    /**
     * OTP failure step that stops the chain.
     * @returns A stop result with OTP error.
     */
    const otpFail: LoginStep = (): Promise<IStepResult> =>
      Promise.resolve({ shouldContinue: false, result: otpErr });
    const post: LoginStep = jest.fn().mockResolvedValue({ shouldContinue: true });
    const chainCtx = { page: {} as Page, activeFrame: {} as Page, loginSetup: {} } as never;
    const chainResult = await MIDDLEWARE.runLoginChain([pass, otpFail, post], chainCtx);
    expect(chainResult).toEqual(otpErr);
    expect(chainResult?.errorType).toBe(ScraperErrorTypes.InvalidOtp);
    expect(post).not.toHaveBeenCalled();
  });
});
