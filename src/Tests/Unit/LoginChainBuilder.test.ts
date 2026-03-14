import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { ILoginContext, INamedLoginStep, IStepResult } from '../../Common/LoginMiddleware.js';
import type { ILoginOptions } from '../../Scrapers/Base/BaseScraperHelpers.js';
import type { ILoginStepContext } from '../../Scrapers/Base/LoginSteps.js';

/** Step names returned by the core builder (always present). */
const CORE_STEP_NAMES = ['navigate', 'parse-page', 'fill', 'wait', 'check-result'];

/** Step name appended when OTP confirm is enabled. */
const OTP_CONFIRM_STEP = 'otp-confirm';

/** Step name appended when OTP code is enabled. */
const OTP_CODE_STEP = 'otp-code';

/** Step name always appended as the final step. */
const POST_ACTION_STEP = 'post-action';

/** Stub step result for mocked LoginSteps functions. */
const STUB_RESULT: IStepResult = { shouldContinue: true };

jest.unstable_mockModule('../../Scrapers/Base/LoginSteps.js', () => ({
  /**
   * Stub navigate step.
   * @returns stub result
   */
  stepNavigate: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub parse login page step.
   * @returns stub result
   */
  stepParseLoginPage: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub fill and submit step.
   * @returns stub result
   */
  stepFillAndSubmit: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub wait after submit step.
   * @returns stub result
   */
  stepWaitAfterSubmit: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub check early result step.
   * @returns stub result
   */
  stepCheckEarlyResult: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub OTP confirm step.
   * @returns stub result
   */
  stepOtpConfirm: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub OTP code step.
   * @returns stub result
   */
  stepOtpCode: jest.fn().mockResolvedValue(STUB_RESULT),
  /**
   * Stub post action step.
   * @returns stub result
   */
  stepPostAction: jest.fn().mockResolvedValue(STUB_RESULT),
}));

const LOGIN_CHAIN_MOD = await import('../../Scrapers/Base/LoginChainBuilder.js');
const LOGIN_STEPS_MOD = await import('../../Scrapers/Base/LoginSteps.js');

/**
 * Create a minimal ILoginStepContext stub for testing.
 * @returns a stub step context
 */
function createStubStepCtx(): ILoginStepContext {
  return {
    page: {} as Page,
    activeLoginContext: null,
    otpPhoneHint: '',
    diagState: { loginUrl: 'https://bank.co.il', lastAction: 'init' },
    emitProgress: jest.fn().mockReturnValue(true),
    navigateTo: jest.fn().mockResolvedValue(true),
    fillInputs: jest.fn().mockResolvedValue(true),
    loginResultCtx: jest.fn().mockReturnValue({
      page: {} as Page,
      diagState: { lastAction: 'init' },
      emitProgress: jest.fn(),
    }),
  } as unknown as ILoginStepContext;
}

/**
 * Create a minimal ILoginOptions stub for testing.
 * @returns a stub login options object
 */
function createStubLoginOptions(): ILoginOptions {
  return {
    loginUrl: 'https://bank.co.il',
    fields: [],
    submitButtonSelector: '#submit',
    possibleResults: {},
  } as unknown as ILoginOptions;
}

/**
 * Create a login context with configurable loginSetup flags.
 * @param flags - OTP and second login flags
 * @returns a stub ILoginContext
 */
function createCtx(flags: Partial<ILoginContext['loginSetup']> = {}): ILoginContext {
  return {
    page: {} as Page,
    activeFrame: {} as Page,
    loginSetup: {
      isApiOnly: false,
      hasOtpConfirm: false,
      hasOtpCode: false,
      ...flags,
    },
  };
}

/**
 * Extract step names from the chain for assertion.
 * @param chain - the login chain array
 * @returns array of step name strings
 */
function extractStepNames(chain: INamedLoginStep[]): string[] {
  return chain.map(s => s.name);
}

/**
 * Build a login chain using the default export with simple-login flags.
 * @param flags - optional loginSetup flag overrides
 * @returns the built login chain
 */
function buildChain(flags: Partial<ILoginContext['loginSetup']> = {}): INamedLoginStep[] {
  const stepCtx = createStubStepCtx();
  const loginOptions = createStubLoginOptions();
  const ctx = createCtx(flags);
  return LOGIN_CHAIN_MOD.default(stepCtx, loginOptions, ctx);
}

describe('buildLoginChain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('core steps (buildCoreSteps)', () => {
    it('returns all 5 core steps plus post-action for simple login', () => {
      const chain = buildChain();
      const names = extractStepNames(chain);
      expect(names).toEqual([...CORE_STEP_NAMES, POST_ACTION_STEP]);
    });

    it('returns exactly 6 steps when no OTP flags are set', () => {
      const chain = buildChain();
      expect(chain).toHaveLength(6);
    });

    it('core steps are in the correct order', () => {
      const chain = buildChain();
      const names = extractStepNames(chain);
      const navigateIdx = names.indexOf('navigate');
      const parseIdx = names.indexOf('parse-page');
      const fillIdx = names.indexOf('fill');
      const waitIdx = names.indexOf('wait');
      const checkIdx = names.indexOf('check-result');
      expect(navigateIdx).toBeLessThan(parseIdx);
      expect(parseIdx).toBeLessThan(fillIdx);
      expect(fillIdx).toBeLessThan(waitIdx);
      expect(waitIdx).toBeLessThan(checkIdx);
    });

    it('each step has an executable function', () => {
      const chain = buildChain();
      for (const step of chain) {
        expect(typeof step.execute).toBe('function');
      }
    });
  });

  describe('OTP confirm (appendOtpConfirm)', () => {
    it('appends otp-confirm when hasOtpConfirm is true', () => {
      const chain = buildChain({ hasOtpConfirm: true });
      const names = extractStepNames(chain);
      expect(names).toContain(OTP_CONFIRM_STEP);
    });

    it('places otp-confirm after check-result and before post-action', () => {
      const chain = buildChain({ hasOtpConfirm: true });
      const names = extractStepNames(chain);
      const confirmIdx = names.indexOf(OTP_CONFIRM_STEP);
      const checkIdx = names.indexOf('check-result');
      const postIdx = names.indexOf(POST_ACTION_STEP);
      expect(confirmIdx).toBeGreaterThan(checkIdx);
      expect(confirmIdx).toBeLessThan(postIdx);
    });

    it('does NOT include otp-confirm when hasOtpConfirm is false', () => {
      const chain = buildChain({ hasOtpConfirm: false });
      const names = extractStepNames(chain);
      expect(names).not.toContain(OTP_CONFIRM_STEP);
    });
  });

  describe('remaining steps (appendRemainingSteps)', () => {
    it('appends otp-code when hasOtpCode is true', () => {
      const chain = buildChain({ hasOtpCode: true });
      const names = extractStepNames(chain);
      expect(names).toContain(OTP_CODE_STEP);
    });

    it('always appends post-action as the last step', () => {
      const chain = buildChain({ hasOtpCode: true });
      const names = extractStepNames(chain);
      const lastStep = names[names.length - 1];
      expect(lastStep).toBe(POST_ACTION_STEP);
    });

    it('does NOT include otp-code when hasOtpCode is false', () => {
      const chain = buildChain({ hasOtpCode: false });
      const names = extractStepNames(chain);
      expect(names).not.toContain(OTP_CODE_STEP);
    });
  });

  describe('full chain combinations', () => {
    it('includes all optional steps when all flags are true', () => {
      const chain = buildChain({
        hasOtpConfirm: true,
        hasOtpCode: true,
      });
      const names = extractStepNames(chain);
      const expectedNames = [...CORE_STEP_NAMES, OTP_CONFIRM_STEP, OTP_CODE_STEP, POST_ACTION_STEP];
      expect(names).toEqual(expectedNames);
      expect(chain).toHaveLength(8);
    });

    it('orders otp-confirm before otp-code', () => {
      const chain = buildChain({ hasOtpConfirm: true, hasOtpCode: true });
      const names = extractStepNames(chain);
      const confirmIdx = names.indexOf(OTP_CONFIRM_STEP);
      const codeIdx = names.indexOf(OTP_CODE_STEP);
      expect(confirmIdx).toBeLessThan(codeIdx);
    });
  });

  describe('step execution delegates to LoginSteps', () => {
    it('navigate step calls stepNavigate with stepCtx and loginOptions', async () => {
      const stepCtx = createStubStepCtx();
      const loginOptions = createStubLoginOptions();
      const ctx = createCtx();
      const chain = LOGIN_CHAIN_MOD.default(stepCtx, loginOptions, ctx);
      const navigateStep = chain.find(s => s.name === 'navigate');
      await navigateStep?.execute(ctx);
      expect(LOGIN_STEPS_MOD.stepNavigate).toHaveBeenCalledWith(stepCtx, loginOptions);
    });

    it('fill step calls stepFillAndSubmit with stepCtx, loginOptions, and ctx', async () => {
      const stepCtx = createStubStepCtx();
      const loginOptions = createStubLoginOptions();
      const ctx = createCtx();
      const chain = LOGIN_CHAIN_MOD.default(stepCtx, loginOptions, ctx);
      const fillStep = chain.find(s => s.name === 'fill');
      await fillStep?.execute(ctx);
      expect(LOGIN_STEPS_MOD.stepFillAndSubmit).toHaveBeenCalledWith(stepCtx, loginOptions, ctx);
    });

    it('post-action step calls stepPostAction', async () => {
      const stepCtx = createStubStepCtx();
      const loginOptions = createStubLoginOptions();
      const ctx = createCtx();
      const chain = LOGIN_CHAIN_MOD.default(stepCtx, loginOptions, ctx);
      const postStep = chain.find(s => s.name === POST_ACTION_STEP);
      await postStep?.execute(ctx);
      expect(LOGIN_STEPS_MOD.stepPostAction).toHaveBeenCalledWith(stepCtx, loginOptions);
    });
  });

  describe('false-positive guards', () => {
    it('does NOT append otp-confirm when only hasOtpCode is true', () => {
      const chain = buildChain({ hasOtpCode: true, hasOtpConfirm: false });
      const names = extractStepNames(chain);
      expect(names).not.toContain(OTP_CONFIRM_STEP);
    });

    it('post-action is always present even with no optional steps', () => {
      const chain = buildChain();
      const names = extractStepNames(chain);
      expect(names).toContain(POST_ACTION_STEP);
    });

    it('each step name is unique within the chain', () => {
      const chain = buildChain({
        hasOtpConfirm: true,
        hasOtpCode: true,
      });
      const names = extractStepNames(chain);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
