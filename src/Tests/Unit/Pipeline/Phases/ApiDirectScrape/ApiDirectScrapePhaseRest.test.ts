/**
 * REST-style flow integration test for the ApiDirectScrape phase.
 *
 * The sister file {@link ./ApiDirectScrapePhase.test.ts} parameterises
 * the GraphQL path (apiQuery dispatch, no body signing). This file
 * exercises the OTHER dispatch branch — REST via `apiPost` driven by
 * `urlTag` + `bodyTemplate`. One end-to-end phase invocation drives
 * the uncovered hot paths in:
 *
 *   - ApiDirectScrapeDispatch.dispatchStep        (REST branch)
 *   - ApiDirectScrapeDispatch.resolveStepBody     (bodyTemplate hydrate)
 *   - ApiDirectScrapeDispatch.asPlainObject       (success branch)
 *   - ApiDirectScrapeDispatch.maybeSignBody       (no-signer short-circuit)
 *   - ApiDirectScrapeDispatch.buildScrapeScope    (session-context read)
 *
 * Per test-guidlines.md ("integration test over unit test, unit test
 * for edge cases only") this is the primary flow surface — the parser
 * + writeAtPointer helpers are exercised through the public phase API,
 * not poked directly.
 *
 * The body-signer half of the dispatch surface (signAndWrite ⇒
 * attachBodySignature) is covered separately by RunStepCrypto.test.ts
 * because the scrape dispatcher's signer scope is bound to the frozen
 * SCRAPE_CONFIG_SENTINEL which has no secrets slot — banks declaring a
 * scrape-shape signer rely on the login-flow's signer scope, which is
 * what RunStepCrypto exercises end-to-end.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { JsonValueTemplate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IScrapeState,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** REST account ref — minimum payload the REST shape extractor returns. */
interface IRestAcct {
  readonly id: string;
  readonly num: string;
}

/** Captured apiPost call — body is the SIGNED + hydrated payload. */
interface IPostCapture {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** Per-step paginated cursor + items, as the shape's extractor returns. */
interface IRestPage {
  readonly items: readonly object[];
  readonly nextCursor: string | false;
}

/**
 * Pre-script of apiPost responses keyed by an opaque queueIndex tag —
 * each call dequeues from the head per index group.
 */
type PostRouter = Record<'customer' | 'balance' | 'transactions', readonly Procedure<unknown>[]>;

/** Shared bodyTemplate — references the bearerSlot session-context value. */
const BODY_TEMPLATE: JsonValueTemplate = {
  auth: { token: { $ref: 'carry.bearerSlot' } },
  payload: { kind: { $literal: 'rest' } },
};

/**
 * Synthetic accountNumberOf — passthrough on `num`.
 * @param a - Account ref.
 * @returns Display number.
 */
function restAcctNumber(a: IRestAcct): string {
  return a.num;
}

/**
 * Empty-vars helper for the customer step (REST body is built from the template).
 * @returns Empty record.
 */
function restEmptyVars(): Record<string, unknown> {
  return {};
}

/**
 * Per-account id-vars helper for balance + transactions steps.
 * @param a - Account ref.
 * @returns Variables map keyed by id.
 */
function restIdVars(a: IRestAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Customer-step extractor — pulls the account list out of the body.
 * @param args - Extract args (uses args.body only).
 * @param args.body - Hydrated response body.
 * @returns Account list.
 */
function restExtractAccounts(args: {
  readonly body: Record<string, unknown>;
}): readonly IRestAcct[] {
  return (args.body as { accts: readonly IRestAcct[] }).accts;
}

/**
 * Balance-step extractor — reads the balance scalar.
 * @param body - Balance response body.
 * @returns Balance value.
 */
function restExtractBalance(body: Record<string, unknown>): number {
  return (body as { balance: number }).balance;
}

/**
 * Transactions-step extractor — passes the page through unchanged.
 * @param args - Extract args (uses args.body only).
 * @param args.body - Hydrated response body.
 * @returns Generic page.
 */
function restExtractPage(args: { readonly body: Record<string, unknown> }): IRestPage {
  return args.body as unknown as IRestPage;
}

/**
 * REST shape — uses urlTag + bodyTemplate so dispatch flows through apiPost.
 * @returns Bank-agnostic REST shape literal.
 */
function makeRestShape(): IApiDirectScrapeShape<IRestAcct, string> {
  return {
    stepName: 'ApiDirectScrapeRestFlowTest',
    accountNumberOf: restAcctNumber,
    customer: {
      buildVars: restEmptyVars,
      extractAccounts: restExtractAccounts,
      urlTag: 'identity.deviceToken',
      bodyTemplate: BODY_TEMPLATE,
    },
    balance: {
      buildVars: restIdVars,
      extract: restExtractBalance,
      urlTag: 'identity.otpPrepare',
      bodyTemplate: BODY_TEMPLATE,
    },
    transactions: {
      buildVars: restIdVars,
      extractPage: restExtractPage,
      urlTag: 'identity.otpVerify',
      bodyTemplate: BODY_TEMPLATE,
    },
  };
}

/**
 * Build the canned router fixtures the REST flow expects.
 * @returns Router pre-loaded for customer + balance + transactions.
 */
function makeHappyRouter(): PostRouter {
  return {
    customer: [succeed({ accts: [{ id: 'rest-a1', num: 'rest-num-1' }] })],
    balance: [succeed({ balance: 4242 })],
    transactions: [succeed({ items: [{ id: 'rt-1' }], nextCursor: false })],
  };
}

/**
 * Match a captured URL tag to its router queue. Maps the same URL tags
 * declared in the shape to the queue groups so we never write an inline
 * if/else ladder.
 */
const URL_TAG_TO_QUEUE: Readonly<Record<string, keyof PostRouter>> = {
  'identity.deviceToken': 'customer',
  'identity.otpPrepare': 'balance',
  'identity.otpVerify': 'transactions',
};

/** Mutable queue accumulator built once per router instance. */
type MutQueues = Record<keyof PostRouter, Procedure<unknown>[]>;

/**
 * Clone the router into mutable per-key queues so apiPost can shift them.
 * @param router - Original (immutable) router fixture.
 * @returns Mutable per-key queues.
 */
function cloneQueues(router: PostRouter): MutQueues {
  return {
    customer: [...router.customer],
    balance: [...router.balance],
    transactions: [...router.transactions],
  };
}

/** Pre-built session-context returned by the REST bus stub. */
const REST_SESSION_CONTEXT: Readonly<Record<string, unknown>> = { bearerSlot: 'session-bearer' };

/**
 * Read the next queued response for a captured URL. Empty queue → fail()
 * so the caller surfaces the misconfiguration. The URL-to-queue table is
 * total over the URL tags declared by `makeRestShape`, so the queue
 * lookup never misses at runtime.
 * @param queues - Mutable router queues.
 * @param url - Captured URL tag from apiPost.
 * @returns Next queued procedure (or fail when none).
 */
function shiftQueueResponse(queues: MutQueues, url: string): Procedure<unknown> {
  const queueKey = URL_TAG_TO_QUEUE[url];
  const next = queues[queueKey].shift();
  if (next) return next;
  return fail(ScraperErrorTypes.Generic, `REST: no stub for ${url}`);
}

/**
 * getSessionContext stub — returns the pre-built post-login carry.
 * Module-scope so banks reading the bus see a stable snapshot
 * (S7721 — no per-call closure capture).
 * @returns Frozen session-context snapshot.
 */
function restSessionContext(): Readonly<Record<string, unknown>> {
  return REST_SESSION_CONTEXT;
}

/**
 * Build a router-backed REST mediator.
 * @param router - Pre-script of responses per URL group.
 * @param captures - Output slot — populated on every apiPost call.
 * @returns Mock mediator.
 */
function makeRestBus(router: PostRouter, captures: IPostCapture[]): IApiMediator {
  const queues = cloneQueues(router);
  const apiPost = jest.fn(
    async (url: string, body: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      captures.push({ url, body });
      return shiftQueueResponse(queues, url);
    },
  );
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn(restSessionContext),
  } as unknown as IApiMediator;
}

/**
 * Build a pipeline context carrying the REST bus.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
function makeRestCtx(bus: IApiMediator): IActionContext {
  const base = makeMockContext({ apiMediator: some(bus) });
  return base as unknown as IActionContext;
}

/**
 * Read the hydrated `auth.token` value from one captured body.
 * @param c - Captured apiPost call.
 * @returns The token (or undefined when absent).
 */
function readAuthToken(c: IPostCapture): unknown {
  const auth = c.body.auth as { token: unknown };
  return auth.token;
}

/**
 * Predicate — true when the captured token equals the expected bearer.
 * @param token - Token value extracted from a capture.
 * @returns True on match.
 */
function isSessionBearer(token: unknown): boolean {
  return token === 'session-bearer';
}

describe('createApiDirectScrapePhase ApiDirectScrape REST flow', () => {
  it('ADS-REST-1 dispatches via apiPost, hydrates template, extracts accounts', async () => {
    const captures: IPostCapture[] = [];
    const router = makeHappyRouter();
    const bus = makeRestBus(router, captures);
    const ctx = makeRestCtx(bus);
    const shape = makeRestShape();
    const phase = createApiDirectScrapePhase(shape);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].balance).toBe(4242);
  });

  it('ADS-REST-2 every captured body hydrates carry.bearerSlot from session-context', async () => {
    const captures: IPostCapture[] = [];
    const router = makeHappyRouter();
    const bus = makeRestBus(router, captures);
    const ctx = makeRestCtx(bus);
    const shape = makeRestShape();
    const phase = createApiDirectScrapePhase(shape);
    const result = await phase(ctx);
    expect(result.success).toBe(true);
    // 3 captures (customer + balance + transactions), each carrying
    // the hydrated bearerSlot value under `auth.token`.
    expect(captures).toHaveLength(3);
    const tokens = captures.map(readAuthToken);
    const didAllMatch = tokens.every(isSessionBearer);
    expect(didAllMatch).toBe(true);
  });

  it('ADS-REST-3 apiPost transport failure surfaces verbatim', async () => {
    const baseRouter = makeHappyRouter();
    const router: PostRouter = {
      ...baseRouter,
      customer: [fail(ScraperErrorTypes.Generic, 'REST transport boom')],
    };
    const captures: IPostCapture[] = [];
    const bus = makeRestBus(router, captures);
    const ctx = makeRestCtx(bus);
    const shape = makeRestShape();
    const phase = createApiDirectScrapePhase(shape);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('REST transport boom');
  });
});

describe('createApiDirectScrapePhase ApiDirectScrape dynamic urlTag + skipFetch', () => {
  it('ADS-REST-DYN-1 resolves a function-producer urlTag against the driver context', async () => {
    const captures: IPostCapture[] = [];
    const router = makeHappyRouter();
    const bus = makeRestBus(router, captures);
    const ctx = makeRestCtx(bus);
    const baseShape = makeRestShape();
    /**
     * Function producer for the customer urlTag — bound to the ctx to
     * prove the dispatcher invokes it rather than treating it literally.
     * @returns Static WK URL tag.
     */
    function customerUrlProducer(): 'identity.deviceToken' {
      return 'identity.deviceToken';
    }
    const shape = {
      ...baseShape,
      customer: { ...baseShape.customer, urlTag: customerUrlProducer },
    };
    const phase = createApiDirectScrapePhase(shape);
    const result = await phase(ctx);
    expect(result.success).toBe(true);
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it('ADS-REST-SKIP-1 bypasses the customer network call when skipFetch=true', async () => {
    const captures: IPostCapture[] = [];
    const router = makeHappyRouter();
    const bus = makeRestBus(router, captures);
    const ctx = makeRestCtx(bus);
    const baseShape = makeRestShape();
    /**
     * extractAccounts variant that synthesises a single account from
     * session-context — skipFetch=true means the network call is
     * bypassed entirely.
     * @returns Synthetic account list of length 1.
     */
    function extractFromSession(): readonly IRestAcct[] {
      return [{ id: 'session-id-1', num: 'session-num-1' }];
    }
    const shape = {
      ...baseShape,
      customer: { ...baseShape.customer, skipFetch: true, extractAccounts: extractFromSession },
    };
    const phase = createApiDirectScrapePhase(shape);
    const result = await phase(ctx);
    expect(result.success).toBe(true);
    // 2 captures only (balance + transactions) — customer is skipped.
    expect(captures).toHaveLength(2);
  });
});

describe('buildApiDirectScrapePhase ApiDirectScrape post hook', () => {
  it('ADS-REST-POST-1 emits audit when ctx.scrape.has', async () => {
    const shape = makeRestShape();
    const phase = buildApiDirectScrapePhase(shape);
    const acct = { accountNumber: 'rest-num-1', balance: 4242, txns: [] };
    const scrapeState: IScrapeState = { accounts: [acct] };
    const base = makeMockContext();
    const ctx: IPipelineContext = { ...base, scrape: some(scrapeState) };
    const result = await phase.post(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.scrape.has).toBe(true);
      if (result.value.scrape.has) expect(result.value.scrape.value.accounts).toHaveLength(1);
    }
  });

  it('ADS-REST-POST-2 short-circuits silently when scrape slot is empty', async () => {
    const shape = makeRestShape();
    const phase = buildApiDirectScrapePhase(shape);
    const base = makeMockContext();
    const ctx: IPipelineContext = { ...base, scrape: none() };
    const result = await phase.post(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.scrape.has).toBe(false);
  });
});
