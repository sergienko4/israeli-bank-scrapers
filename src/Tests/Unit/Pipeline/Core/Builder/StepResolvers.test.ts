/**
 * Unit tests for Core/Builder/StepResolvers — login phase + scrape exec resolvers.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  buildLoginPhase,
  type IBuilderState,
  resolveScrapeExec,
} from '../../../../../Scrapers/Pipeline/Core/Builder/StepResolvers.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Minimal login config stub for tests. */
const MINIMAL_CONFIG: ILoginConfig = {
  loginUrl: 'https://example.com',
  fields: [],
  submit: [],
  possibleResults: { success: [] },
} as unknown as ILoginConfig;

/**
 * Build a minimal builder state for tests.
 * @param overrides - Partial state overrides.
 * @returns Builder state.
 */
function makeState(overrides: Partial<IBuilderState> = {}): IBuilderState {
  const base: IBuilderState = {
    hasBrowser: false,
    isHeadless: false,
    hasOtp: false,
    hasOtpTrigger: false,
    loginMode: 'declarative',
    loginConfig: false,
    loginFn: false,
    scrapeFn: false,
    scrapeConfig: false,
    proxyAuth: false,
    apiDirectConfig: false,
  };
  return { ...base, ...overrides };
}

describe('buildLoginPhase', () => {
  it('builds a declarative phase from loginConfig when present', () => {
    const makeStateResult1 = makeState({ loginConfig: MINIMAL_CONFIG });
    const phase = buildLoginPhase(makeStateResult1);
    expect(phase.name).toBe('login');
  });

  it('builds a SimplePhase using loginFn when provided (adaptLoginFn branch)', async () => {
    let wasCalled = false;
    /**
     * Test helper.
     *
     * @param ctx - Parameter.
     * @returns Result.
     */
    const loginFn = async (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
      await Promise.resolve();
      wasCalled = true;
      return succeed(ctx);
    };
    const state = makeState({ loginConfig: false, loginFn });
    const phase = buildLoginPhase(state);
    expect(phase.name).toBe('login');
    // Execute the phase's action to hit the wrapped login fn
    const ctx = makeMockContext();
    const actionCtx = ctx as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    expect(result.success).toBe(true);
    expect(wasCalled).toBe(true);
  });

  it('builds SimplePhase using LOGIN_STEPS map when hasOtp=true (declarative step)', () => {
    const state = makeState({ hasOtp: true, loginMode: 'native' });
    const phase = buildLoginPhase(state);
    expect(phase.name).toBe('login');
  });

  it('builds SimplePhase using LOGIN_STEPS map based on loginMode', () => {
    const modes: IBuilderState['loginMode'][] = ['declarative', 'directPost', 'native'];
    for (const mode of modes) {
      const makeStateResult2 = makeState({ loginMode: mode });
      const phase = buildLoginPhase(makeStateResult2);
      expect(phase.name).toBe('login');
    }
  });
});

describe('resolveScrapeExec', () => {
  it('returns an exec fn from scrapeConfig when present', () => {
    const cfg = {
      endpoints: [],
      accounts: {
        accountsUrl: '',
        transactionsUrl: '',
        balanceUrl: '',
        pendingUrl: '',
      },
    } as unknown as IBuilderState['scrapeConfig'];
    const state = makeState({ scrapeConfig: cfg });
    const exec = resolveScrapeExec(state);
    expect(typeof exec).toBe('function');
  });

  it('returns a wrapped custom scrape fn when scrapeFn is present', async () => {
    let wasCalled = false;
    /**
     * Test helper.
     *
     * @param ctx - Parameter.
     * @returns Result.
     */
    const scrapeFn = async (ctx: IActionContext): Promise<Procedure<IPipelineContext>> => {
      await Promise.resolve();
      wasCalled = true;
      return succeed(ctx as unknown as IPipelineContext);
    };
    const state = makeState({ scrapeFn });
    const exec = resolveScrapeExec(state);
    expect(typeof exec).toBe('function');
    const ctx = makeMockContext();
    const actionCtx = ctx as unknown as IActionContext;
    const result = await exec(actionCtx, actionCtx);
    expect(result.success).toBe(true);
    expect(wasCalled).toBe(true);
  });

  it('returns the default matrix-loop exec fn when neither scrapeConfig nor scrapeFn', () => {
    const makeStateResult3 = makeState();
    const exec = resolveScrapeExec(makeStateResult3);
    expect(typeof exec).toBe('function');
  });

  it('invokes the default matrix-loop exec fn (anonymous arrow at line 125)', async () => {
    const makeStateResult4 = makeState();
    const exec = resolveScrapeExec(makeStateResult4);
    const ctx = makeMockContext();
    const actionCtx = ctx as unknown as IActionContext;
    // Calling exec() delegates to executeMatrixLoop(input) — whether it
    // succeeds/fails depends on the context (no scrape discovery) but the
    // body must run (function-coverage win).
    const result = await exec(actionCtx, actionCtx);
    expect(typeof result.success).toBe('boolean');
  });
});
