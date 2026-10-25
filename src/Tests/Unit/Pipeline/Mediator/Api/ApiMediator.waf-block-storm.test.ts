/**
 * Regression tests for the OneZero edge-block retry storm (2026-08).
 *
 * <p>A zone-wide Cloudflare rule began answering every identity call with a
 * 403 block page. That failure carries the same `<sp>403:<sp>` marker Pepper's
 * CloudFront edge uses for a stale bearer, so the retry wrapper read the block
 * as an auth rejection and re-minted the token. Re-minting replays the cold
 * login flow through the SAME mediator, whose first step calls straight back
 * into `apiPost` — mutual recursion that never unwound. It fired 7177 requests
 * in 4.5 minutes at an edge that had already said no, and logged not one
 * failure, because no attempt ever returned.
 *
 * <p>These tests pin BOTH guards: a WAF block is terminal, and a refresh can
 * never re-enter a refresh. Each would hang or overflow before the fix.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { createApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { classifyHttpFailure } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HttpFailureClassifier.js';
import type { ITokenBus } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  CLOUDFLARE_BLOCK_PAGE,
  CLOUDFLARE_CHALLENGE_HEADERS,
  CLOUDFLARE_CHALLENGE_PAGE,
  CLOUDFRONT_BLOCK_PAGE,
} from '../../../../Helpers/EdgeBlockPages.js';

/** Test-only creds shape — opaque to the mediator + builder. */
interface ITestCreds {
  readonly marker: string;
}

/** Mutable tallies shared between the fetch stub and the token strategy. */
interface ITally {
  fetches: number;
  refreshes: number;
}

/** Fake Authorization header value used as the refresh success payload. */
const FRESH_HEADER = '******';

/** Reuse an existing WKUrlGroup so the factory's URL resolver succeeds. */
const TEST_URL_TAG = 'auth.bind' as const;

/** URL the fake edge answers for. */
const EDGE_URL = 'https://bank.example.com/customer';

/** What the fetch strategies return for a Cloudflare block page. */
const CLOUDFLARE_BLOCKED = classifyHttpFailure<unknown>({
  verb: 'POST',
  url: EDGE_URL,
  status: 403,
  body: CLOUDFLARE_BLOCK_PAGE,
  headers: {},
});

/** What they return for a Cloudflare challenge, which no API client can solve. */
const CLOUDFLARE_CHALLENGED = classifyHttpFailure<unknown>({
  verb: 'POST',
  url: EDGE_URL,
  status: 403,
  body: CLOUDFLARE_CHALLENGE_PAGE,
  headers: CLOUDFLARE_CHALLENGE_HEADERS,
});

/** Every edge refusal the fetch strategies classify as WafBlocked. */
const EDGE_REFUSALS = [
  { label: 'block page', refusal: CLOUDFLARE_BLOCKED },
  { label: 'challenge', refusal: CLOUDFLARE_CHALLENGED },
] as const;

/** What they return for Pepper's CloudFront 403 — a stale-bearer signal. */
const CLOUDFRONT_REJECTED = classifyHttpFailure<unknown>({
  verb: 'POST',
  url: EDGE_URL,
  status: 403,
  body: CLOUDFRONT_BLOCK_PAGE,
  headers: {},
});

/** Genuine auth rejection — must still earn exactly one re-mint. */
const MSG_401 = `POST ${EDGE_URL} 401: not authorised`;

/**
 * Ceiling on fetches for one guarded `apiPost` against a rejecting edge:
 * the original attempt plus a single replay from the one allowed re-mint.
 */
const MAX_FETCHES = 2;

/**
 * Minimal pipeline-context stub — never inspected, the strategies are fakes.
 * @returns Empty ctx.
 */
function makeStubCtx(): IPipelineContext {
  return {} as unknown as IPipelineContext;
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
 * Fetch strategy that always replays one rejection, counting invocations.
 *
 * Models a persistently rejecting edge — the condition under which the
 * recursion used to run unbounded.
 * @param rejection - Failure returned on every call.
 * @param tally - Shared counters.
 * @returns Fetch strategy stub.
 */
function rejectingFetchStrategy(rejection: Procedure<unknown>, tally: ITally): IFetchStrategy {
  /**
   * Count the call and replay the rejection.
   * @returns The configured failure.
   */
  async function fetchPost(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    tally.fetches = tally.fetches + 1;
    return rejection;
  }
  /**
   * Unused fetchGet — these tests never hit it.
   * @returns Wired-off failure.
   */
  async function fetchGet(): Promise<Procedure<unknown>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'not wired');
  }
  return { fetchPost, fetchGet } as unknown as IFetchStrategy;
}

/**
 * Token strategy whose `primeFresh` replays a request through the SAME bus.
 *
 * This is the shape of every API_DIRECT resolver: a cold re-mint reruns the
 * bank's login flow, whose first step is an `apiPost` on the mediator that
 * asked for the re-mint. Reproducing it here is the whole point — the prior
 * suite only ever used a `primeFresh` that never called back, which is
 * exactly why the storm shipped.
 * @param tally - Shared counters.
 * @returns Strategy stub that re-enters the bus.
 */
function reentrantStrategy(tally: ITally): ITokenStrategy<ITestCreds> {
  /**
   * Cheap path — unused by these tests.
   * @returns Success procedure.
   */
  async function primeInitial(): Promise<Procedure<string>> {
    await Promise.resolve();
    return succeed(FRESH_HEADER);
  }
  /**
   * Cold path — replays the first login step through the same bus.
   * @param bus - The mediator that requested the re-mint.
   * @returns Fresh header, or the replay's failure.
   */
  async function primeFresh(bus: ITokenBus): Promise<Procedure<string>> {
    tally.refreshes = tally.refreshes + 1;
    const replay = await bus.apiPost(TEST_URL_TAG, {});
    if (!replay.success) return fail(ScraperErrorTypes.Generic, 'cold replay rejected');
    return succeed(FRESH_HEADER);
  }
  /**
   * Warm-state flag.
   * @returns True.
   */
  function hasWarmState(): boolean {
    return true;
  }
  return { name: 'reentrant', primeInitial, primeFresh, hasWarmState };
}

/**
 * Wire a mediator to a rejecting edge and a re-entrant token strategy.
 * @param rejection - Failure the edge replays on every call.
 * @param tally - Shared counters.
 * @returns Ready-to-fire mediator.
 */
function buildMediator(
  rejection: Procedure<unknown>,
  tally: ITally,
): ReturnType<typeof createApiMediator> {
  const fetchStrat = rejectingFetchStrategy(rejection, tally);
  const graphql = stubGraphqlStrategy();
  const mediator = createApiMediator(CompanyTypes.OneZero, fetchStrat, graphql);
  const strategy = reentrantStrategy(tally);
  const ctx = makeStubCtx();
  mediator.withTokenStrategy(strategy, ctx, { marker: 'x' });
  return mediator;
}

/** Register a fake URL before the suite runs so apiPost can resolve it. */
beforeAll(() => {
  registerWkUrl(TEST_URL_TAG, CompanyTypes.OneZero, EDGE_URL);
});

describe('ApiMediator — WAF block is terminal', () => {
  it.each(EDGE_REFUSALS)(
    'never re-mints a token after a Cloudflare $label',
    async ({ refusal }) => {
      const tally: ITally = { fetches: 0, refreshes: 0 };
      const result = await buildMediator(refusal, tally).apiPost(TEST_URL_TAG, {});
      expect(result.success).toBe(false);
      expect(tally.refreshes).toBe(0);
      expect(tally.fetches).toBe(1);
    },
  );

  it.each(EDGE_REFUSALS)('surfaces a Cloudflare $label as WafBlocked', async ({ refusal }) => {
    const tally: ITally = { fetches: 0, refreshes: 0 };
    const result = await buildMediator(refusal, tally).apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
  });

  it('still re-mints once on a CloudFront 403, which signals a stale bearer', async () => {
    const tally: ITally = { fetches: 0, refreshes: 0 };
    await buildMediator(CLOUDFRONT_REJECTED, tally).apiPost(TEST_URL_TAG, {});
    expect(tally.refreshes).toBe(1);
  });
});

describe('ApiMediator — refresh re-entrancy guard', () => {
  it('bounds the flow when a re-mint replays through the same bus', async () => {
    const tally: ITally = { fetches: 0, refreshes: 0 };
    const rejected = fail(ScraperErrorTypes.Generic, MSG_401);
    const result = await buildMediator(rejected, tally).apiPost(TEST_URL_TAG, {});
    expect(result.success).toBe(false);
    expect(tally.fetches).toBeLessThanOrEqual(MAX_FETCHES);
  });

  it('still allows exactly one re-mint on a genuine auth rejection', async () => {
    const tally: ITally = { fetches: 0, refreshes: 0 };
    const rejected = fail(ScraperErrorTypes.Generic, MSG_401);
    await buildMediator(rejected, tally).apiPost(TEST_URL_TAG, {});
    expect(tally.refreshes).toBe(1);
  });
});
