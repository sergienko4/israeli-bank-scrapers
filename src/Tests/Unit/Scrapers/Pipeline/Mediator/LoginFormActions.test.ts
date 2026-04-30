/**
 * Unit tests for LoginFormActions — fillAndSubmit form-scoped submit.
 * Validates that submit candidates are scoped to the discovered form anchor.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Login/LoginFillStep.js',
  () => ({
    fillOneField: jest.fn(),
    validateCredentials: jest.fn(),
    reduceField: jest.fn(),
  }),
);

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Form/LoginScopeResolver.js',
  () => ({
    passwordFirst: jest.fn((fields: unknown[]) => fields),
    fillFieldStep: jest.fn(),
  }),
);

const FILL_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/Login/LoginFillStep.js');
const LFA_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/Form/LoginFormActions.js');
const FACTORY = await import('../MockPipelineFactories.js');

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** No-op mock logger for tests. */
const MOCK_LOGGER = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(),
} as unknown as ScraperLogger;

/** Submit candidate used in test configs. */
const SUBMIT_CANDIDATE: SelectorCandidate = {
  kind: 'xpath' as const,
  value: '//button[@type="submit"]',
};

/**
 * Minimal login config with 1 field + 1 submit candidate.
 * @returns ILoginConfig for tests.
 */
function makeLoginConfig(): ILoginConfig {
  return {
    loginUrl: 'https://bank.example.com/login',
    fields: [{ credentialKey: 'password', selectors: [] }],
    submit: [SUBMIT_CANDIDATE],
  } as unknown as ILoginConfig;
}

/** Mock found result for resolveAndClick. */
const FOUND_RESULT = { ...NOT_FOUND_RESULT, found: true, value: 'כניסה' };
/** Wrapped succeed of found result. */
const SUCCEED_FOUND: Procedure<IRaceResult> = succeed(FOUND_RESULT);
/** Resolved promise of succeed found — avoids nested calls. */
const RESOLVED_FOUND: Promise<Procedure<IRaceResult>> = Promise.resolve(SUCCEED_FOUND);

/**
 * Setup mocks so fillAndSubmit reaches the submit-click path.
 * @returns True when setup is complete.
 */
/** Whether test setup completed. */
type DidSetup = boolean;

/**
 * Setup mocks so fillAndSubmit reaches the submit-click path.
 * @returns True when setup is complete.
 */
function setupFillSuccess(): DidSetup {
  const validateFn = FILL_MOD.validateCredentials as unknown as jest.Mock;
  const validResult = succeed(true);
  validateFn.mockReturnValue(validResult);
  const reduceFn = FILL_MOD.reduceField as unknown as jest.Mock;
  reduceFn.mockImplementation((_ctx: unknown, prev: Promise<unknown>): Promise<unknown> => prev);
  return true;
}

/**
 * Build mediator overrides for scope + click spies.
 * @param scopeFn - Form scoping function.
 * @param clickFn - Click function.
 * @returns Partial IElementMediator overrides.
 */
function buildScopeOverrides(
  scopeFn: IElementMediator['scopeToForm'],
  clickFn: IElementMediator['resolveAndClick'],
): Partial<IElementMediator> {
  return { scopeToForm: scopeFn, resolveAndClick: clickFn };
}

// ── fillAndSubmit / scopeToForm ─────────────────────────

describe('fillAndSubmit/scopeToForm', () => {
  beforeEach(() => setupFillSuccess());

  it('calls scopeToForm on submit candidates before clicking', async () => {
    /** Passthrough scope spy that records calls. */
    const scopeSpy = jest.fn((c: readonly SelectorCandidate[]): readonly SelectorCandidate[] => c);
    /** Click spy that returns found result. */
    const clickSpy = jest.fn((): Promise<Procedure<IRaceResult>> => RESOLVED_FOUND);
    const overrides = buildScopeOverrides(scopeSpy, clickSpy);
    const mediator = FACTORY.makeMockMediator(overrides);
    const config = makeLoginConfig();
    await LFA_MOD.fillAndSubmit({
      mediator,
      config,
      creds: { password: 'test123' },
      logger: MOCK_LOGGER,
    });
    expect(scopeSpy).toHaveBeenCalledWith(config.submit);
  });

  it('passes scoped candidates to resolveAndClick', async () => {
    /** Scoped candidates returned by scopeToForm. */
    const scoped: readonly SelectorCandidate[] = [
      { kind: 'css' as const, value: 'form#login button' },
    ];
    /** Scope spy that returns scoped candidates. */
    const scopeSpy = jest.fn((): readonly SelectorCandidate[] => scoped);
    /** Click spy that returns found result. */
    const clickSpy = jest.fn((): Promise<Procedure<IRaceResult>> => RESOLVED_FOUND);
    const overrides = buildScopeOverrides(scopeSpy, clickSpy);
    const mediator = FACTORY.makeMockMediator(overrides);
    const config2 = makeLoginConfig();
    await LFA_MOD.fillAndSubmit({
      mediator,
      config: config2,
      creds: { password: 'x' },
      logger: MOCK_LOGGER,
    });
    expect(clickSpy).toHaveBeenCalledWith(scoped);
  });

  it('returns succeed when scoped submit clicked', async () => {
    const found = { ...NOT_FOUND_RESULT, found: true, value: 'כניסה לחשבון' };
    const succeedFound = succeed(found);
    const resolvedSucceed = Promise.resolve(succeedFound);
    /**
     * Passthrough scope — returns candidates unchanged.
     * @param c - Input candidates.
     * @returns Same candidates array.
     */
    const passthrough = (c: readonly SelectorCandidate[]): readonly SelectorCandidate[] => c;
    /**
     * Click mock — returns success.
     * @returns Resolved succeed procedure.
     */
    const clickMock = (): Promise<Procedure<IRaceResult>> => resolvedSucceed;
    const overrides = buildScopeOverrides(passthrough, clickMock);
    const mediator = FACTORY.makeMockMediator(overrides);
    const config = makeLoginConfig();
    const result = await LFA_MOD.fillAndSubmit({
      mediator,
      config,
      creds: { password: 'x' },
      logger: MOCK_LOGGER,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.method).toBe('click');
  });
});
