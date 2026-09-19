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
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
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

/**
 * Build a hook that records the warm verdict handed to it.
 *
 * <p>`recoverSessionOp` flips the session cold *before* firing the hook
 * (recover-once), so a hook that asks the bus after the fact always sees
 * `false`. The verdict therefore has to travel as an argument, and this
 * recorder is what pins that.
 * @param sink - Array receiving each verdict.
 * @returns Recovery hook that records then resolves.
 */
function verdictRecordingHook(sink: boolean[]): RecoveredHook {
  /**
   * Record the warm verdict then resolve.
   * @param _header - Fresh header (not under test here).
   * @param wasWarm - Whether the session was warm before recovery.
   * @returns Resolved once recorded.
   */
  async function hook(_header: string, wasWarm: boolean): Promise<void> {
    sink.push(wasWarm);
    await Promise.resolve();
  }
  return hook;
}

describe('ApiMediator.recoverSession — warm verdict reaches the hook', () => {
  it('tells the hook the session was warm even though the flag is already cold', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const mediator = makeMediator(strategy);
    mediator.setSessionWarm(true);
    const verdicts: boolean[] = [];
    const hook = verdictRecordingHook(verdicts);
    mediator.withRecoveryHook?.(hook);
    await mediator.recoverSession();
    expect(verdicts).toEqual([true]);
  });

  it('tells the hook the session was already cold when it never went warm', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const mediator = makeMediator(strategy);
    const verdicts: boolean[] = [];
    const hook = verdictRecordingHook(verdicts);
    mediator.withRecoveryHook?.(hook);
    await mediator.recoverSession();
    expect(verdicts).toEqual([false]);
  });
});

/** Inline absolute URL the retry tests fire at. */
const ACCOUNTS_URL = literalUrl('https://example.test/accounts');

/** Second inline URL, used once the scripted rejection is spent. */
const CLEAN_URL = literalUrl('https://example.test/clean');

/** Payload the retried (second) attempt resolves with. */
const RETRIED_PAYLOAD = 'retried-ok';

/** Error message carrying the embedded status the retry path keys on. */
const UNAUTHORIZED_MESSAGE = 'GET 401: unauthorized';

/**
 * Build a fetch strategy whose first GET is rejected with an embedded 401
 * and whose every later GET succeeds.
 *
 * <p>This is the shape a bank produces when a stored long-term token is
 * revoked server-side mid-scrape: the call that carried it comes back
 * unauthorized, and the same call succeeds once a fresh bearer is installed.
 * @returns Fetch strategy stub scripted for one rejection.
 */
function fetchStrategyRejectingFirstGet(): IFetchStrategy {
  let attempts = 0;
  /**
   * Reject once, then succeed.
   * @returns Failure on the first call, success afterwards.
   */
  async function fetchGet(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    attempts += 1;
    if (attempts === 1) return fail(ScraperErrorTypes.Generic, UNAUTHORIZED_MESSAGE);
    return succeed(RETRIED_PAYLOAD);
  }
  /**
   * Wired-off fetchPost.
   * @returns Generic failure.
   */
  async function fetchPost(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'not wired');
  }
  return { fetchPost, fetchGet } as unknown as IFetchStrategy;
}

/**
 * Build a mediator over a caller-supplied fetch strategy.
 * @param strategy - Token strategy to register.
 * @param fetchStub - Fetch strategy backing apiGet/apiPost.
 * @returns Configured mediator.
 */
function makeMediatorOver(
  strategy: ITokenStrategy<ITestCreds>,
  fetchStub: IFetchStrategy,
): ReturnType<typeof createApiMediator> {
  const graphqlStub = stubGraphqlStrategy();
  const mediator = createApiMediator(CompanyTypes.OneZero, fetchStub, graphqlStub);
  const ctx = makeStubCtx();
  mediator.withTokenStrategy(strategy, ctx, { marker: 'x' });
  return mediator;
}

/** Everything a recovery hook was handed, in fire order. */
interface IHookCapture {
  readonly headers: string[];
  readonly verdicts: boolean[];
}

/**
 * Build a hook that records both arguments it is fired with.
 * @param capture - Sink receiving headers and warm verdicts.
 * @returns Recovery hook that records then resolves.
 */
function capturingHook(capture: IHookCapture): RecoveredHook {
  /**
   * Record both arguments then resolve.
   * @param header - Fresh header from a successful recovery.
   * @param wasWarm - Session warmth before recovery flipped it cold.
   * @returns Resolved once recorded.
   */
  async function hook(header: string, wasWarm: boolean): Promise<void> {
    capture.headers.push(header);
    capture.verdicts.push(wasWarm);
    await Promise.resolve();
  }
  return hook;
}

/**
 * Build a fresh capture sink.
 * @returns Empty capture.
 */
function newCapture(): IHookCapture {
  return { headers: [], verdicts: [] };
}

describe('ApiMediator.apiGet — a mid-run 401 re-caches the re-minted token', () => {
  it('fires the recovery hook with the fresh header after an in-request refresh', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const fetchStub = fetchStrategyRejectingFirstGet();
    const mediator = makeMediatorOver(strategy, fetchStub);
    mediator.setSessionWarm(true);
    const capture = newCapture();
    const hook = capturingHook(capture);
    mediator.withRecoveryHook?.(hook);
    const result = await mediator.apiGet<string>(ACCOUNTS_URL);
    expect(result.success).toBe(true);
    expect(capture.headers).toEqual([FRESH_HEADER]);
  });

  it('tells the hook the dead session had been warm', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const fetchStub = fetchStrategyRejectingFirstGet();
    const mediator = makeMediatorOver(strategy, fetchStub);
    mediator.setSessionWarm(true);
    const capture = newCapture();
    const hook = capturingHook(capture);
    mediator.withRecoveryHook?.(hook);
    await mediator.apiGet<string>(ACCOUNTS_URL);
    expect(capture.verdicts).toEqual([true]);
  });

  it('does not fire the hook when the request never hits an auth rejection', async () => {
    const okFresh = succeed(FRESH_HEADER);
    const strategy = strategyWithFresh(okFresh);
    const fetchStub = fetchStrategyRejectingFirstGet();
    const mediator = makeMediatorOver(strategy, fetchStub);
    const capture = newCapture();
    const hook = capturingHook(capture);
    mediator.withRecoveryHook?.(hook);
    await mediator.apiGet<string>(ACCOUNTS_URL);
    const second = await mediator.apiGet<string>(CLEAN_URL);
    expect(second.success).toBe(true);
    expect(capture.headers).toEqual([FRESH_HEADER]);
  });
});
