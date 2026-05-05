/**
 * Unit tests for ApiMediator's retry-on-401 wrapper, driven
 * through the public withTokenStrategy API. 401 detection reads
 * the error-message format produced by NativeFetchStrategy:
 * `"<VERB> <URL> 401: <body>"`.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { createApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { AuthorizationHeaderValue } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenResolver.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
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
const FRESH_HEADER: AuthorizationHeaderValue = 'Bearer refresh-token-abc';

/** Reuse an existing WKUrlGroup so the factory's URL resolver succeeds. */
const TEST_URL_TAG = 'auth.bind' as const;

/** 401 error-message patterns matching NativeFetchStrategy output. */
const MSG_401_FIRST = 'POST https://bank.example.com/customer 401: not authorised';
const MSG_401_SECOND = 'POST https://bank.example.com/customer 401: still denied';

/**
 * Minimal pipeline-context stub — withTokenStrategy never inspects it
 * in these tests because the strategies are fakes.
 * @returns Empty ctx.
 */
function makeStubCtx(): IPipelineContext {
  return {} as unknown as IPipelineContext;
}

/**
 * Build a fetch strategy that replays a scripted sequence across
 * sequential fetchPost calls.
 * @param sequence - Results to emit, oldest first.
 * @returns Fetch strategy stub.
 */
function scriptedFetchStrategy(sequence: readonly Procedure<unknown>[]): IFetchStrategy {
  const queue = [...sequence];
  /**
   * Pull the next scripted response.
   * @returns Next queued procedure, or a generic failure once exhausted.
   */
  function nextResponse(): Procedure<unknown> {
    const next = queue.shift();
    if (next === undefined) return fail(ScraperErrorTypes.Generic, 'queue exhausted');
    return next;
  }
  /**
   * Stub for every fetchPost call — returns the next scripted response.
   * @returns Queued procedure.
   */
  async function fetchPost(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    return nextResponse();
  }
  /**
   * Unused fetchGet — tests don't hit this path.
   * @returns Wired-off failure.
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
 * Build a scripted ITokenStrategy whose primeFresh returns a
 * pre-scripted Procedure.
 * @param freshResults - Ordered results to emit on successive primeFresh calls.
 * @returns Strategy stub.
 */
function scriptedStrategy(
  freshResults: readonly Procedure<AuthorizationHeaderValue>[],
): ITokenStrategy<ITestCreds> {
  const queue = [...freshResults];
  /**
   * primeInitial is not exercised through retryOn401 — returns
   * a default success to satisfy the port shape.
   * @returns Success procedure.
   */
  async function primeInitial(): Promise<Procedure<AuthorizationHeaderValue>> {
    await Promise.resolve();
    return succeed(FRESH_HEADER);
  }
  /**
   * Pull the next scripted fresh result.
   * @returns Queued procedure.
   */
  async function primeFresh(): Promise<Procedure<AuthorizationHeaderValue>> {
    await Promise.resolve();
    const next = queue.shift();
    if (next === undefined) return fail(ScraperErrorTypes.Generic, 'fresh exhausted');
    return next;
  }
  /**
   * Static warm-state flag — always true so the builder's ladder
   * will retry on a primeInitial failure (not used by these tests).
   * @returns True.
   */
  function hasWarmState(): boolean {
    return true;
  }
  return { name: 'test-strategy', primeInitial, primeFresh, hasWarmState };
}

/**
 * Throwing primeFresh used to exercise ApiMediator.safeRefresh.
 * @throws Always throws a ScraperError on invocation.
 */
async function throwingPrimeFresh(): Promise<Procedure<AuthorizationHeaderValue>> {
  await Promise.resolve();
  throw new ScraperError('resolver boom');
}

/**
 * primeInitial stub for the throwing strategy — never reached
 * via retryOn401.
 * @returns Success procedure.
 */
async function throwingPrimeInitial(): Promise<Procedure<AuthorizationHeaderValue>> {
  await Promise.resolve();
  return succeed(FRESH_HEADER);
}

/**
 * Warm-state flag for the throwing strategy.
 * @returns True.
 */
function throwingHasWarmState(): boolean {
  return true;
}

/** Register a fake URL before the suite runs so apiPost can resolve it. */
beforeAll(() => {
  registerWkUrl(TEST_URL_TAG, CompanyTypes.OneZero, 'https://bank.example.com/customer');
});

describe('ApiMediator.retryOn401 — NULL_RESOLVER path', () => {
  it('returns 401 verbatim when no strategy is registered', async () => {
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const strategy = scriptedFetchStrategy([initial401]);
    const graphql = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, strategy, graphql);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('401');
  });
});

describe('ApiMediator.retryOn401 — strategy registered via withTokenStrategy', () => {
  it('does NOT refresh on a 200 response', async () => {
    const fetchStrat = scriptedFetchStrategy([succeed({ ok: true })]);
    const graphql0 = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql0);
    let freshCount = 0;
    /**
     * Counting primeFresh — increments on every invocation.
     * @returns Success procedure.
     */
    async function countingFresh(): Promise<Procedure<AuthorizationHeaderValue>> {
      await Promise.resolve();
      freshCount = freshCount + 1;
      return succeed(FRESH_HEADER);
    }
    /**
     * primeInitial used during withTokenStrategy registration only.
     * @returns Success procedure.
     */
    async function countingInitial(): Promise<Procedure<AuthorizationHeaderValue>> {
      await Promise.resolve();
      return succeed(FRESH_HEADER);
    }
    /**
     * Warm-state flag — unused here (no fail on primeInitial).
     * @returns True.
     */
    function warmYes(): boolean {
      return true;
    }
    const countingStrategy: ITokenStrategy<ITestCreds> = {
      name: 'count',
      primeInitial: countingInitial,
      primeFresh: countingFresh,
      hasWarmState: warmYes,
    };
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(countingStrategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(true);
    expect(freshCount).toBe(0);
  });

  it('refreshes once + retries on 401 + returns success', async () => {
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const retriedOk = succeed({ ok: 'retried' });
    const fetchStrat = scriptedFetchStrategy([initial401, retriedOk]);
    const graphql = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql);
    const refreshOk = succeed(FRESH_HEADER);
    const strategy = scriptedStrategy([refreshOk]);
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(strategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(true);
  });

  it('returns second 401 without infinite loop', async () => {
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const second401 = fail(ScraperErrorTypes.Generic, MSG_401_SECOND);
    const fetchStrat = scriptedFetchStrategy([initial401, second401]);
    const graphql = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql);
    const refreshOk = succeed(FRESH_HEADER);
    const strategy = scriptedStrategy([refreshOk]);
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(strategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('denied');
  });

  it('returns the ORIGINAL 401 when primeFresh itself fails', async () => {
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const fetchStrat = scriptedFetchStrategy([initial401]);
    const graphql = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql);
    const refreshFail = fail(ScraperErrorTypes.Generic, 'refresh denied');
    const strategy = scriptedStrategy([refreshFail]);
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(strategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not authorised');
  });

  it('converts a thrown primeFresh into a failure + returns the original 401', async () => {
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const fetchStrat = scriptedFetchStrategy([initial401]);
    const graphql = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql);
    const throwingStrategy: ITokenStrategy<ITestCreds> = {
      name: 'throws',
      primeInitial: throwingPrimeInitial,
      primeFresh: throwingPrimeFresh,
      hasWarmState: throwingHasWarmState,
    };
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(throwingStrategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not authorised');
  });
});

describe('ApiMediator.primeSession — direct invocation', () => {
  it('NULL_RESOLVER path fails without a registered strategy', async () => {
    const noOp = scriptedFetchStrategy([]);
    const graphqlNoOp = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, noOp, graphqlNoOp);
    const result = await mediator.primeSession();
    expect(result.success).toBe(false);
  });

  it('returns the header value when a strategy primes successfully', async () => {
    const noOp = scriptedFetchStrategy([]);
    const graphqlNoOp = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, noOp, graphqlNoOp);
    const refreshOk = succeed(FRESH_HEADER);
    const strategy = scriptedStrategy([refreshOk]);
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(strategy, ctx0, creds0);
    const result = await mediator.primeSession();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(FRESH_HEADER);
  });

  it('ignores empty-string refresh result and returns original 401', async () => {
    const empty = succeed('');
    const initial401 = fail(ScraperErrorTypes.Generic, MSG_401_FIRST);
    const fetchStrat = scriptedFetchStrategy([initial401]);
    const graphql0 = stubGraphqlStrategy();
    const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql0);
    const strategy = scriptedStrategy([empty]);
    const ctx0 = makeStubCtx();
    const creds0 = { marker: 'x' };
    mediator.withTokenStrategy(strategy, ctx0, creds0);
    const result = await mediator.apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not authorised');
  });
});
