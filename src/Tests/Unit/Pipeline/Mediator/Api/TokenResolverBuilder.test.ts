/**
 * Unit tests for TokenResolverBuilder — the generic retry-ladder
 * builder that bridges ITokenStrategy<TCreds> to ITokenResolver.
 * Pins the stored-then-fresh fallback semantic (spec.txt §A.3)
 * and the plain refresh() path (always runs primeFresh).
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { AuthorizationHeaderValue } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenResolver.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { buildResolverFromStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Test-only creds shape — opaque to the builder. */
interface ITestCreds {
  readonly storedToken: string;
}

/** Sample strategy name — verified via resolver.name echo. */
const STRATEGY_NAME = 'TestStrategy';

/** Two distinct synthetic header values used across cases. */
const INITIAL_HEADER: AuthorizationHeaderValue = 'Bearer synthetic-initial';
const FRESH_HEADER: AuthorizationHeaderValue = 'Bearer synthetic-fresh';

/**
 * Build a stub IApiMediator — no behaviour; the builder just
 * passes it through to the strategy. Unused inside these tests
 * because the strategies here are fakes.
 * @returns Minimal mediator stub.
 */
function makeStubMediator(): IApiMediator {
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    withTokenResolver: jest.fn(),
    withTokenStrategy: jest.fn(),
  } as unknown as IApiMediator;
}

/**
 * Build a minimal stub IPipelineContext — the builder does not
 * inspect it; strategies here ignore it.
 * @returns Minimal context stub.
 */
function makeStubCtx(): IPipelineContext {
  return {} as unknown as IPipelineContext;
}

/** Outcome pair recording which methods the strategy invoked. */
interface ICallCounts {
  primeInitial: number;
  primeFresh: number;
  hasWarmState: number;
}

/**
 * Build a scripted ITokenStrategy — each prime call returns a
 * pre-scripted Procedure; hasWarmState returns a fixed flag.
 * @param initialResult - Procedure returned by primeInitial.
 * @param freshResult - Procedure returned by primeFresh.
 * @param warmFlag - Static hasWarmState return.
 * @returns Fake strategy + live call counters.
 */
function makeScriptedStrategy(
  initialResult: Procedure<AuthorizationHeaderValue>,
  freshResult: Procedure<AuthorizationHeaderValue>,
  warmFlag: boolean,
): { strategy: ITokenStrategy<ITestCreds>; counts: ICallCounts } {
  const counts: ICallCounts = { primeInitial: 0, primeFresh: 0, hasWarmState: 0 };
  /**
   * Scripted primeInitial — increments count, returns scripted result.
   * @returns Scripted procedure.
   */
  async function primeInitial(): Promise<Procedure<AuthorizationHeaderValue>> {
    await Promise.resolve();
    counts.primeInitial = counts.primeInitial + 1;
    return initialResult;
  }
  /**
   * Scripted primeFresh — increments count, returns scripted result.
   * @returns Scripted procedure.
   */
  async function primeFresh(): Promise<Procedure<AuthorizationHeaderValue>> {
    await Promise.resolve();
    counts.primeFresh = counts.primeFresh + 1;
    return freshResult;
  }
  /**
   * Scripted hasWarmState — increments count, returns fixed flag.
   * @returns Fixed warm-state flag.
   */
  function hasWarmState(): boolean {
    counts.hasWarmState = counts.hasWarmState + 1;
    return warmFlag;
  }
  const strategy: ITokenStrategy<ITestCreds> = {
    name: STRATEGY_NAME,
    primeInitial,
    primeFresh,
    hasWarmState,
  };
  return { strategy, counts };
}

describe('buildResolverFromStrategy — resolve() ladder', () => {
  it('returns primeInitial success verbatim + skips primeFresh', async () => {
    const initialOk = succeed(INITIAL_HEADER);
    const freshFail = fail(ScraperErrorTypes.Generic, 'should-not-be-called');
    const { strategy, counts } = makeScriptedStrategy(initialOk, freshFail, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'abc' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.resolve();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(INITIAL_HEADER);
    expect(counts.primeInitial).toBe(1);
    expect(counts.primeFresh).toBe(0);
  });

  it('primeInitial fail + warm state → retries via primeFresh', async () => {
    const initialFail = fail(ScraperErrorTypes.Generic, 'stored denied');
    const freshOk = succeed(FRESH_HEADER);
    const { strategy, counts } = makeScriptedStrategy(initialFail, freshOk, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'stale' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.resolve();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(FRESH_HEADER);
    expect(counts.primeInitial).toBe(1);
    expect(counts.primeFresh).toBe(1);
    expect(counts.hasWarmState).toBe(1);
  });

  it('primeInitial fail + cold state → returns fail verbatim', async () => {
    const initialFail = fail(ScraperErrorTypes.Generic, 'no stored');
    const freshFail = fail(ScraperErrorTypes.Generic, 'should-not-be-called');
    const { strategy, counts } = makeScriptedStrategy(initialFail, freshFail, false);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: '' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.resolve();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('no stored');
    expect(counts.primeInitial).toBe(1);
    expect(counts.primeFresh).toBe(0);
    expect(counts.hasWarmState).toBe(1);
  });

  it('primeInitial fail + warm state + primeFresh fail → returns primeFresh fail', async () => {
    const initialFail = fail(ScraperErrorTypes.Generic, 'stored denied');
    const freshFail = fail(ScraperErrorTypes.Generic, 'fresh denied');
    const { strategy, counts } = makeScriptedStrategy(initialFail, freshFail, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'stale' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.resolve();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('fresh denied');
    expect(counts.primeInitial).toBe(1);
    expect(counts.primeFresh).toBe(1);
  });
});

describe('buildResolverFromStrategy — refresh() path', () => {
  it('always runs primeFresh (NOT primeInitial)', async () => {
    const initialFail = fail(ScraperErrorTypes.Generic, 'should-not-be-called');
    const freshOk = succeed(FRESH_HEADER);
    const { strategy, counts } = makeScriptedStrategy(initialFail, freshOk, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'abc' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.refresh();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(FRESH_HEADER);
    expect(counts.primeInitial).toBe(0);
    expect(counts.primeFresh).toBe(1);
    expect(counts.hasWarmState).toBe(0);
  });

  it('propagates primeFresh failure verbatim', async () => {
    const initialFail = fail(ScraperErrorTypes.Generic, 'should-not-be-called');
    const freshFail = fail(ScraperErrorTypes.Generic, 'fresh denied');
    const { strategy } = makeScriptedStrategy(initialFail, freshFail, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'abc' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    const result = await resolver.refresh();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('fresh denied');
  });
});

describe('buildResolverFromStrategy — identity', () => {
  it('resolver.name echoes strategy.name', () => {
    const initialOk = succeed(INITIAL_HEADER);
    const freshOk = succeed(FRESH_HEADER);
    const { strategy } = makeScriptedStrategy(initialOk, freshOk, true);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const creds: ITestCreds = { storedToken: 'abc' };
    const resolver = buildResolverFromStrategy({ strategy, bus, ctx, creds });
    expect(resolver.name).toBe(STRATEGY_NAME);
  });

  it('each build produces an independent resolver (closure isolation)', async () => {
    const initialOk1 = succeed('header-A');
    const freshOk1 = succeed('header-A-fresh');
    const pair1 = makeScriptedStrategy(initialOk1, freshOk1, false);
    const initialOk2 = succeed('header-B');
    const freshOk2 = succeed('header-B-fresh');
    const pair2 = makeScriptedStrategy(initialOk2, freshOk2, false);
    const bus = makeStubMediator();
    const ctx = makeStubCtx();
    const r1 = buildResolverFromStrategy({
      strategy: pair1.strategy,
      bus,
      ctx,
      creds: { storedToken: 'x' },
    });
    const r2 = buildResolverFromStrategy({
      strategy: pair2.strategy,
      bus,
      ctx,
      creds: { storedToken: 'y' },
    });
    const out1 = await r1.resolve();
    const out2 = await r2.resolve();
    expect(out1.success && out1.value).toBe('header-A');
    expect(out2.success && out2.value).toBe('header-B');
  });
});
