/**
 * Unit tests for TokenLoginOrchestrator — the shared login-phase
 * body that collapses OneZeroLogin.ts + PepperLogin.ts (and any
 * future token-lifecycle bank) into a single delegation point.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { AuthorizationHeaderValue } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenResolver.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { runTokenStrategyLogin } from '../../../../../Scrapers/Pipeline/Mediator/Api/TokenLoginOrchestrator.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Test-only creds shape. */
interface ITestCreds {
  readonly marker: string;
}

/** Sample initial header value. */
const INITIAL_HEADER: AuthorizationHeaderValue = 'Bearer synthetic-initial';

/**
 * Build a mediator stub whose methods are jest.fn() spies. The
 * orchestrator calls withTokenStrategy + setRawAuth; those are
 * asserted against.
 * @param primedResult - Procedure the mocked primeSession resolves to.
 * @returns Mediator with spy-able methods.
 */
function makeMediatorSpy(primedResult: Procedure<AuthorizationHeaderValue>): IApiMediator {
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    withTokenResolver: jest.fn(),
    withTokenStrategy: jest.fn(),
    primeSession: jest.fn(async () => {
      await Promise.resolve();
      return primedResult;
    }),
  };
}

/**
 * Unused primeFresh for stub strategies — never reached by the
 * orchestrator path under test (orchestrator calls primeSession,
 * which is mocked separately on the mediator).
 * @returns Failure (never reached).
 */
async function stubPrimeFresh(): Promise<Procedure<AuthorizationHeaderValue>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, 'fresh not expected in this test');
}

/**
 * Static warm-state predicate for stub strategies — unused by the
 * orchestrator (warm-state logic lives inside the builder/primeSession).
 * @returns False.
 */
function stubHasWarmState(): boolean {
  return false;
}

/**
 * Build a strategy whose primeInitial returns a scripted result.
 * @param initialResult - Result to emit on primeInitial.
 * @returns Strategy stub.
 */
function stubStrategy(
  initialResult: Procedure<AuthorizationHeaderValue>,
): ITokenStrategy<ITestCreds> {
  /**
   * Scripted primeInitial.
   * @returns Scripted result.
   */
  async function primeInitial(): Promise<Procedure<AuthorizationHeaderValue>> {
    await Promise.resolve();
    return initialResult;
  }
  return {
    name: 'test',
    primeInitial,
    primeFresh: stubPrimeFresh,
    hasWarmState: stubHasWarmState,
  };
}

/** Synthetic creds marker — credentials cast is opaque in the orchestrator. */
const SYN_CREDS = { marker: 'test' };

/**
 * Build a pipeline context with an absent apiMediator.
 * @returns Pipeline context with none() in apiMediator slot.
 */
function makeCtxWithoutMediator(): IPipelineContext {
  const base = makeMockContext();
  const slotEmpty = none() as unknown as IPipelineContext['apiMediator'];
  const credsCast = SYN_CREDS as unknown as IPipelineContext['credentials'];
  return { ...base, credentials: credsCast, apiMediator: slotEmpty };
}

/**
 * Build a pipeline context with the supplied mediator injected.
 * @param bus - Mediator to install.
 * @returns Pipeline context.
 */
function makeCtxWithMediator(bus: IApiMediator): IPipelineContext {
  const base = makeMockContext();
  const slotFilled = some(bus) as unknown as IPipelineContext['apiMediator'];
  const credsCast = SYN_CREDS as unknown as IPipelineContext['credentials'];
  return { ...base, credentials: credsCast, apiMediator: slotFilled };
}

describe('TokenLoginOrchestrator.runTokenStrategyLogin — shared login body', () => {
  it('returns fail when mediator is not in context', async () => {
    const okInitial = succeed(INITIAL_HEADER);
    const strategy = stubStrategy(okInitial);
    const ctx = makeCtxWithoutMediator();
    const result = await runTokenStrategyLogin('TestLogin', strategy, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage.length).toBeGreaterThan(0);
  });

  it('propagates primeSession failure without calling setRawAuth', async () => {
    const primedFail = fail(ScraperErrorTypes.Generic, 'prime denied');
    const bus = makeMediatorSpy(primedFail);
    const unusedInitial = fail(ScraperErrorTypes.Generic, 'unused');
    const strategy = stubStrategy(unusedInitial);
    const ctx = makeCtxWithMediator(bus);
    const result = await runTokenStrategyLogin('TestLogin', strategy, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('prime denied');
    expect(bus.setRawAuth).not.toHaveBeenCalled();
  });

  it('registers the strategy via withTokenStrategy on success', async () => {
    const primedOk = succeed(INITIAL_HEADER);
    const bus = makeMediatorSpy(primedOk);
    const okInitial = succeed(INITIAL_HEADER);
    const strategy = stubStrategy(okInitial);
    const ctx = makeCtxWithMediator(bus);
    await runTokenStrategyLogin('TestLogin', strategy, ctx);
    expect(bus.withTokenStrategy).toHaveBeenCalledWith(
      strategy,
      ctx,
      expect.objectContaining({ marker: 'test' }) as unknown,
    );
  });

  it('installs the primed header via setRawAuth and returns the ctx', async () => {
    const primedOk = succeed(INITIAL_HEADER);
    const bus = makeMediatorSpy(primedOk);
    const okInitial = succeed(INITIAL_HEADER);
    const strategy = stubStrategy(okInitial);
    const ctx = makeCtxWithMediator(bus);
    const result = await runTokenStrategyLogin('TestLogin', strategy, ctx);
    expect(result.success).toBe(true);
    expect(bus.setRawAuth).toHaveBeenCalledWith(INITIAL_HEADER);
  });
});
