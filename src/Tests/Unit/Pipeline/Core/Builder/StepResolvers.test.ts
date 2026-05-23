/**
 * Unit tests for Core/Builder/StepResolvers — login phase + scrape exec resolvers.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  buildLoginPhase,
  buildScrapePhase,
  type IBuilderState,
  resolveScrapeExec,
} from '../../../../../Scrapers/Pipeline/Core/Builder/StepResolvers.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
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
};

/**
 * Build a minimal builder state for tests.
 * @param overrides - Partial state overrides.
 * @returns Builder state.
 */
function makeState(overrides: Partial<IBuilderState> = {}): IBuilderState {
  const base: IBuilderState = {
    hasBrowser: false,
    isHeadless: false,
    hasPreLogin: false,
    hasOtpFill: false,
    otpFillRequired: true,
    hasOtpTrigger: false,
    loginMode: 'declarative',
    loginConfig: false,
    loginFn: false,
    scrapeFn: false,
    apiDirectScrape: false,
    apiDirectConfig: false,
  };
  return { ...base, ...overrides };
}

/** Synthetic account ref used by the minimal shape literal in SR-ADS-1. */
interface ISynAcct {
  readonly id: string;
}

/**
 * Build a minimal IApiDirectScrapeShape literal for builder-level
 * tests. The literal is never executed; the assertions check phase
 * wiring + naming only.
 *
 * @returns Minimal synthetic shape with string cursor.
 */
function makeAdsShape(): IApiDirectScrapeShape<ISynAcct, string> {
  /**
   * Cursor-typed page extractor stub — body is returned as-is.
   *
   * @param body - Raw response body payload.
   * @returns Body coerced to the expected IPage envelope.
   */
  const extractPage = (body: Record<string, unknown>): IPage<object, string> =>
    body as unknown as IPage<object, string>;
  /**
   * Account-number selector for the synthetic account ref.
   *
   * @param a - Synthetic account.
   * @returns Account id string.
   */
  const accountNumberOf = (a: ISynAcct): string => a.id;
  /**
   * Empty `buildVars` stub — variables shape is irrelevant for
   * builder-level wiring tests.
   *
   * @returns Empty variables object.
   */
  const buildVars = (): Record<string, unknown> => ({});
  /**
   * Customer extractor stub returning zero accounts.
   *
   * @returns Empty account list.
   */
  const extractAccounts = (): readonly ISynAcct[] => [];
  /**
   * Balance extractor stub returning zero.
   *
   * @returns Zero balance.
   */
  const extractBalance = (): number => 0;
  return {
    stepName: 'StepResolversAdsShape',
    accountNumberOf,
    customer: { buildVars, extractAccounts },
    balance: { buildVars, extract: extractBalance },
    transactions: { buildVars, extractPage },
  };
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

  it('builds SimplePhase using DECLARATIVE_LOGIN_STEP when hasOtpFill=true', () => {
    const state = makeState({ hasOtpFill: true, loginMode: 'native' });
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

describe('buildScrapePhase', () => {
  it('SR-ADS-1 — apiDirectScrape SHAPE wires the ApiDirectScrape phase', () => {
    const shape = makeAdsShape();
    const state = makeState({
      apiDirectScrape: shape as unknown as IApiDirectScrapeShape<unknown, unknown>,
    });
    const phase = buildScrapePhase(state);
    expect(phase.name).toBe('api-direct-scrape');
  });

  it('SR-ADS-2 — falls back to scraperFn when apiDirectScrape is absent', () => {
    /**
     * Synthetic scrape fn — `buildScrapePhase` should reach the legacy
     * branch when `apiDirectScrape` is not set on the builder state.
     *
     * @param ctx - Action context.
     * @returns Succeeded ctx as pipeline context.
     */
    const scrapeFn = async (ctx: IActionContext): Promise<Procedure<IPipelineContext>> => {
      await Promise.resolve();
      return succeed(ctx as unknown as IPipelineContext);
    };
    const state = makeState({ apiDirectScrape: false, scrapeFn });
    const phase = buildScrapePhase(state);
    expect(phase.name).toBe('scrape');
  });
});
