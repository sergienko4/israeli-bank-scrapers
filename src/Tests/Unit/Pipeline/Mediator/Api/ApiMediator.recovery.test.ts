/**
 * Unit tests for ApiMediator's warm-session self-heal primitives:
 * `setSessionWarm` / `wasSessionWarm` (warm-flag round-trip) and
 * `recoverSession` (cold re-mint that discards the degraded session).
 *
 * `recoverSession` reuses the proven refresh path (resolver.refresh ->
 * strategy.primeFresh) and flips the session cold on BOTH success and
 * failure (recover-once), propagating the refresh procedure so the caller
 * fails loud instead of masking a degraded warm token.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { RecoveredHook } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import type { IFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Test-only creds shape — opaque to the mediator + builder. */
interface ITestCreds {
  readonly marker: string;
}

/** Fake Authorization header value used as the refresh success payload. */
const FRESH_HEADER = 'Bearer recover-token-xyz';

/**
 * Minimal pipeline-context stub — withTokenStrategy never inspects it here.
 * @returns Empty ctx.
 */
function makeStubCtx(): IPipelineContext {
  return {} as unknown as IPipelineContext;
}

/**
 * Build a no-op fetch strategy — recovery tests never fire HTTP calls.
 * @returns Fetch strategy stub.
 */
function noOpFetchStrategy(): IFetchStrategy {
  /**
   * Wired-off fetchPost.
   * @returns Generic failure.
   */
  async function fetchPost(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'not wired');
  }
  /**
   * Wired-off fetchGet.
   * @returns Generic failure.
   */
  async function fetchGet(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'not wired');
  }
  return { fetchPost, fetchGet } as unknown as IFetchStrategy;
}

/**
 * Build a stub GraphQL strategy — needed as a factory argument.
 * @returns Minimal stub.
 */
function stubGraphqlStrategy(): GraphQLFetchStrategy {
  /**
   * No-op GraphQL entrypoint.
   * @returns Empty object.
   */
  async function query(): Promise<unknown> {
    await Promise.resolve();
    return {};
  }
  return { query } as unknown as GraphQLFetchStrategy;
}

/**
 * Build a token strategy whose primeFresh emits the given result once.
 * @param freshResult - Result the resolver's refresh() returns.
 * @returns Strategy stub.
 */
function strategyWithFresh(freshResult: Procedure<string>): ITokenStrategy<ITestCreds> {
  /**
   * primeInitial — not exercised by recoverSession.
   * @returns Success procedure.
   */
  async function primeInitial(): Promise<Procedure<string>> {
    await Promise.resolve();
    return succeed(FRESH_HEADER);
  }
  /**
   * primeFresh — returns the scripted result (resolver.refresh path).
   * @returns Scripted procedure.
   */
  async function primeFresh(): Promise<Procedure<string>> {
    await Promise.resolve();
    return freshResult;
  }
  /**
   * Static warm-state flag.
   * @returns True.
   */
  function hasWarmState(): boolean {
    return true;
  }
  return { name: 'recover-strategy', primeInitial, primeFresh, hasWarmState };
}

/**
 * Build a mediator with the given strategy registered (or none).
 * @param strategy - Optional token strategy to register.
 * @returns Configured mediator.
 */
function makeMediator(strategy?: ITokenStrategy<ITestCreds>): ReturnType<typeof createApiMediator> {
  const fetchStub = noOpFetchStrategy();
  const graphqlStub = stubGraphqlStrategy();
  const mediator = createApiMediator(CompanyTypes.OneZero, fetchStub, graphqlStub);
  const ctx = makeStubCtx();
  if (strategy !== undefined) mediator.withTokenStrategy(strategy, ctx, { marker: 'x' });
  return mediator;
}

describe('ApiMediator — warm-flag round-trip', () => {
  it('defaults wasSessionWarm to false', () => {
    const mediator = makeMediator();
    const wasWarm = mediator.wasSessionWarm();
    expect(wasWarm).toBe(false);
  });

  it('round-trips setSessionWarm true then false', () => {
    const mediator = makeMediator();
    mediator.setSessionWarm(true);
    const wasWarmAfterTrue = mediator.wasSessionWarm();
    expect(wasWarmAfterTrue).toBe(true);
    mediator.setSessionWarm(false);
    const wasWarmAfterFalse = mediator.wasSessionWarm();
    expect(wasWarmAfterFalse).toBe(false);
  });
});

/**
 * Build a recording recovery hook that captures each header it is fired with.
 * @param sink - Array receiving every header passed to the hook.
 * @returns Recovery hook that records then resolves.
 */
function recordingHook(sink: string[]): RecoveredHook {
  /**
   * Record the fresh header then resolve.
   * @param header - Fresh header from a successful recovery.
   * @returns Resolved once recorded.
   */
  async function hook(header: string): Promise<void> {
    sink.push(header);
    await Promise.resolve();
  }
  return hook;
}

describe('ApiMediator.recoverSession — re-cache hook (F3)', () => {
  it('fires the recovery hook with the fresh header on success', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const mediator = makeMediator(strategy);
    const captured: string[] = [];
    const hook = recordingHook(captured);
    mediator.withRecoveryHook?.(hook);
    await mediator.recoverSession();
    expect(captured).toEqual([FRESH_HEADER]);
  });

  it('does not fire the recovery hook when refresh fails', async () => {
    const refreshFail = fail(ScraperErrorTypes.Generic, 'refresh denied');
    const strategy = strategyWithFresh(refreshFail);
    const mediator = makeMediator(strategy);
    const captured: string[] = [];
    const hook = recordingHook(captured);
    mediator.withRecoveryHook?.(hook);
    await mediator.recoverSession();
    expect(captured).toEqual([]);
  });
});

describe('ApiMediator.recoverSession — cold re-mint', () => {
  it('returns the fresh header and flips the session cold on success', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const mediator = makeMediator(strategy);
    mediator.setSessionWarm(true);
    const result = await mediator.recoverSession();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(FRESH_HEADER);
    const wasWarm = mediator.wasSessionWarm();
    expect(wasWarm).toBe(false);
  });

  it('propagates the failure and flips cold when refresh fails', async () => {
    const refreshFail = fail(ScraperErrorTypes.Generic, 'refresh denied');
    const strategy = strategyWithFresh(refreshFail);
    const mediator = makeMediator(strategy);
    mediator.setSessionWarm(true);
    const result = await mediator.recoverSession();
    expect(result.success).toBe(false);
    const wasWarm = mediator.wasSessionWarm();
    expect(wasWarm).toBe(false);
  });

  it('fails and flips cold when no resolver is registered', async () => {
    const mediator = makeMediator();
    mediator.setSessionWarm(true);
    const result = await mediator.recoverSession();
    expect(result.success).toBe(false);
    const wasWarm = mediator.wasSessionWarm();
    expect(wasWarm).toBe(false);
  });
});
