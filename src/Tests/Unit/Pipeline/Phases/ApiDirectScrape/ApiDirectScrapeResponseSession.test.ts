/**
 * Unit coverage for the scrape response session: a shape's
 * `responseSession` patch reads each successful scrape answer — the checked
 * body, its declared headers (lower-case) and its HTTP status — and the patch
 * is merged into the session-context before the call returns. A failed patch,
 * a refused merge, or an answer the header sink never saw fails the call,
 * named after the call.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  IApiQueryOpts,
  SessionContext,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import runBootstrap from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeBootstrap.js';
import {
  dispatchStep,
  type IDispatchArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatch.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeTypes.js';
import type {
  ApiBody,
  IApiDirectScrapeBootstrapStep,
  IResponseSessionArgs,
  IResponseSessionSpec,
  SessionContextPatch,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { emitResponseHeaders } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseHeaderSink.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';
import { SYN_CASE } from './ApiDirectScrapeBankShapes.js';

/** One answer on the wire: its HTTP status and headers. */
interface IWireAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** How a bus answers: the wire answers a call sees, its result, and whether it stores. */
interface IBusPlan {
  readonly wire: readonly IWireAnswer[];
  readonly result: Procedure<ApiBody>;
  readonly isStoring: boolean;
}

/** A bus whose session-context is a real store. */
interface ISessionBus {
  readonly bus: IApiMediator;
  readonly session: () => SessionContext;
  readonly apiPost: jest.Mock<Promise<Procedure<ApiBody>>, unknown[]>;
}

/** A recorded response-session patch. */
type PatchFn = jest.Mock<Procedure<SessionContextPatch>, [IResponseSessionArgs]>;

const BALANCE_URL = 'https://bank.example/balance';
const ANSWER_BODY: ApiBody = { Status: { Code: 0 } };
const CHECKED_BODY: ApiBody = { ...ANSWER_BODY, checked: true };
const SESSION_HEADERS: Readonly<Record<string, string>> = {
  JESESSIONID: 'JSESSIONID=s-2; Path=/',
  'XSRF-TOKEN': 'XSRF-TOKEN=x-2',
  'X-Trace': 'trace-1',
};
const WIRE_OK: IWireAnswer = { status: 200, headers: SESSION_HEADERS };
const WIRE_REJECTED: IWireAnswer = { status: 401, headers: { JESESSIONID: 'JSESSIONID=stale' } };
const ROTATED: SessionContextPatch = { session: 's-2' };
const FIRST_SESSION: SessionContext = { mag: 'm-1' };
const BANK_STATUS = fail(ScraperErrorTypes.Generic, 'bank status');
const ROTATE_OK = succeed(ROTATED);
const CHECKED_OK = succeed(CHECKED_BODY);
const MERGE_REFUSED = fail(ScraperErrorTypes.Generic, 'balance session patch refused');
const ANSWER_UNSEEN = fail(ScraperErrorTypes.Generic, 'balance response unseen');

/**
 * Answer a call as a native transport does: each wire answer reaches the
 * call's header sink in turn (a retried call sees more than one), then the
 * call resolves with the result. The opts are the call's last argument.
 * @param plan - The bus plan.
 * @returns The bus verb.
 */
function answerOnWire(plan: IBusPlan): (...args: unknown[]) => Promise<Procedure<ApiBody>> {
  return async (...args: unknown[]): Promise<Procedure<ApiBody>> => {
    await Promise.resolve();
    const opts = args.at(-1) as IApiQueryOpts | undefined;
    const sink = opts?.policy?.headerSink;
    for (const wire of plan.wire) emitResponseHeaders(new Response('{}', wire), BALANCE_URL, sink);
    return plan.result;
  };
}

/**
 * Answer a call without reaching its header sink, as a transport that
 * drops the call policy (GraphQL) does.
 * @param plan - The bus plan.
 * @returns The bus verb.
 */
function answerOffWire(plan: IBusPlan): () => Promise<Procedure<ApiBody>> {
  return (): Promise<Procedure<ApiBody>> => Promise.resolve(plan.result);
}

/** The session-context half of a bus: a real store. */
interface ISessionStore {
  readonly setSessionContext: (next: SessionContext) => boolean;
  readonly getSessionContext: () => SessionContext;
}

/**
 * Build a session-context store that keeps what it is given, unless it
 * refuses every write.
 * @param isStoring - Whether the store accepts writes.
 * @returns The store's setter and getter.
 */
function makeSessionStore(isStoring: boolean): ISessionStore {
  let session = FIRST_SESSION;
  const setSessionContext = jest.fn((next: SessionContext): boolean => {
    if (isStoring) session = next;
    return isStoring;
  });
  /**
   * Read the session-context as last stored.
   * @returns Current session-context.
   */
  function readSession(): SessionContext {
    return session;
  }
  return { setSessionContext, getSessionContext: readSession };
}

/**
 * Build a bus answering every verb by the plan, with a session store.
 * @param plan - The bus plan.
 * @returns Bus, its apiPost mock and a session reader.
 */
function makeSessionBus(plan: IBusPlan): ISessionBus {
  const store = makeSessionStore(plan.isStoring);
  const onWire = answerOnWire(plan);
  const offWire = answerOffWire(plan);
  const apiPost = jest.fn<Promise<Procedure<ApiBody>>, unknown[]>(onWire);
  const apiGet = jest.fn(onWire);
  const apiQuery = jest.fn(offWire);
  const parts = { apiPost, apiGet, apiQuery, ...store };
  const bus = parts as unknown as IApiMediator;
  return { bus, session: store.getSessionContext, apiPost };
}

/**
 * A recorded patch that answers with the given result.
 * @param result - What every patch call returns.
 * @returns Patch mock.
 */
function makePatch(result: Procedure<SessionContextPatch>): PatchFn {
  return jest.fn<Procedure<SessionContextPatch>, [IResponseSessionArgs]>(
    (): Procedure<SessionContextPatch> => result,
  );
}

/**
 * A response session reading the two session headers, in mixed case.
 * @param patch - The patch to run.
 * @returns Response-session spec.
 */
function sessionSpec(patch: PatchFn): IResponseSessionSpec {
  return { headers: ['JESESSIONID', 'Xsrf-Token'], patch };
}

/**
 * Check that marks the body it passes, so the patch can be seen to read it.
 * @param body - The successful response body.
 * @returns The marked body.
 */
function markChecked(body: ApiBody): Procedure<ApiBody> {
  return succeed({ ...body, checked: true });
}

/**
 * Check that refuses every body.
 * @returns A failed check.
 */
function refuseBody(): Procedure<ApiBody> {
  return BANK_STATUS;
}

/**
 * Action context bound to the bus.
 * @param bus - Mediator under test.
 * @returns Cast action context.
 */
function ctxFor(bus: IApiMediator): IActionContext {
  const base = makeMockContext({ apiMediator: some(bus) });
  return base;
}

/**
 * Balance-step dispatch args on the given bus.
 * @param bus - Mediator under test.
 * @param overrides - Fields to override.
 * @returns Dispatch args.
 */
function balanceArgs(bus: IApiMediator, overrides: Partial<IDispatchArgs>): IDispatchArgs {
  return {
    bus,
    ctx: ctxFor(bus),
    queryTag: 'balance',
    urlTag: literalUrl(BALANCE_URL),
    method: 'POST',
    vars: {},
    bodyTemplate: false,
    signer: false,
    opts: { extraHeaders: {} },
    checkBody: markChecked,
    ...overrides,
  };
}

const OK_PLAN: IBusPlan = { wire: [WIRE_OK], result: succeed(ANSWER_BODY), isStoring: true };

describe('ApiDirectScrapeResponseSession/dispatch', () => {
  it.each([{ method: 'POST' as const }, { method: 'GET' as const }])(
    'hands the patch the checked body, declared headers and status on a $method step',
    async ({ method }) => {
      const sb = makeSessionBus(OK_PLAN);
      const patch = makePatch(ROTATE_OK);
      const args = balanceArgs(sb.bus, { method, responseSession: sessionSpec(patch) });
      const result = await dispatchStep(args);
      expect(result).toEqual(CHECKED_OK);
      const headers = { jesessionid: 'JSESSIONID=s-2; Path=/', 'xsrf-token': 'XSRF-TOKEN=x-2' };
      const seen = { body: CHECKED_BODY, headers, status: 200, ctx: args.ctx };
      expect(patch.mock.calls).toEqual([[seen]]);
    },
  );

  it('merges the patch over the session-context before the call returns', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(ROTATE_OK);
    const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
    await dispatchStep(args);
    const session = sb.session();
    expect(session).toEqual({ mag: 'm-1', session: 's-2' });
  });

  it('reads only the final answer of a retried call', async () => {
    const plan = { ...OK_PLAN, wire: [WIRE_REJECTED, WIRE_OK] };
    const sb = makeSessionBus(plan);
    const patch = makePatch(ROTATE_OK);
    const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
    await dispatchStep(args);
    const seen = patch.mock.calls[0][0];
    expect(seen.status).toBe(200);
    expect(seen.headers.jesessionid).toBe('JSESSIONID=s-2; Path=/');
  });

  it.each([
    { name: 'the call', result: BANK_STATUS, checkBody: markChecked },
    { name: 'the body check', result: succeed(ANSWER_BODY), checkBody: refuseBody },
  ])('never runs the patch when $name fails', async ({ result, checkBody }) => {
    const sb = makeSessionBus({ ...OK_PLAN, result });
    const patch = makePatch(ROTATE_OK);
    const args = balanceArgs(sb.bus, { checkBody, responseSession: sessionSpec(patch) });
    const outcome = await dispatchStep(args);
    expect(outcome).toEqual(BANK_STATUS);
    expect(patch).not.toHaveBeenCalled();
    const session = sb.session();
    expect(session).toBe(FIRST_SESSION);
  });

  it.each([
    { label: 'balance', overrides: {} },
    { label: 'login', overrides: { call: 'login' } },
  ])('fails a refused patch as "$label bank status"', async ({ label, overrides }) => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(BANK_STATUS);
    const args = balanceArgs(sb.bus, { ...overrides, responseSession: sessionSpec(patch) });
    const result = await dispatchStep(args);
    const named = fail(ScraperErrorTypes.Generic, `${label} bank status`);
    expect(result).toEqual(named);
    const session = sb.session();
    expect(session).toBe(FIRST_SESSION);
  });

  it('fails the call when the mediator refuses the merged session', async () => {
    const sb = makeSessionBus({ ...OK_PLAN, isStoring: false });
    const patch = makePatch(ROTATE_OK);
    const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
    const result = await dispatchStep(args);
    expect(result).toEqual(MERGE_REFUSED);
  });

  it('fails closed when the answer never reached the header sink', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(ROTATE_OK);
    const args = balanceArgs(sb.bus, { urlTag: false, responseSession: sessionSpec(patch) });
    const result = await dispatchStep(args);
    expect(result).toEqual(ANSWER_UNSEEN);
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends the step opts untouched without a response session', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const args = balanceArgs(sb.bus, {});
    await dispatchStep(args);
    const sentOpts = sb.apiPost.mock.calls[0][2];
    expect(sentOpts).toBe(args.opts);
  });
});

/**
 * Bootstrap patch that keeps nothing.
 * @returns An empty patch.
 */
function emptyPatch(): Procedure<SessionContextPatch> {
  return succeed({});
}

/**
 * Empty request variables.
 * @returns Empty variables object.
 */
function noVars(): Record<string, never> {
  return {};
}

const LOGIN_STEP: IApiDirectScrapeBootstrapStep = {
  urlTag: literalUrl(BALANCE_URL),
  buildVars: noVars,
  extractPatch: emptyPatch,
};

/**
 * Driver context whose shape declares one bootstrap step and a response session.
 * @param sb - Session bus.
 * @param step - The bootstrap step.
 * @param patch - The response-session patch.
 * @returns Cast driver context.
 */
function bootDriver(
  sb: ISessionBus,
  step: IApiDirectScrapeBootstrapStep,
  patch: PatchFn,
): IDriverCtx<unknown, unknown> {
  const shape = { bootstrap: [step], responseSession: sessionSpec(patch) };
  const d = { shape, bus: sb.bus, ctx: ctxFor(sb.bus) };
  return d as unknown as IDriverCtx<unknown, unknown>;
}

describe('ApiDirectScrapeResponseSession/bootstrap', () => {
  it.each([
    { label: 'login', step: { ...LOGIN_STEP, name: 'login' } },
    { label: 'bootstrap', step: LOGIN_STEP },
  ])('names a bootstrap call "$label" in a refused patch', async ({ label, step }) => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(BANK_STATUS);
    const d = bootDriver(sb, step, patch);
    const result = await runBootstrap(d);
    const named = fail(ScraperErrorTypes.Generic, `${label} bank status`);
    expect(result).toEqual(named);
  });

  it('stores the response session of a bootstrap call', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(ROTATE_OK);
    const d = bootDriver(sb, LOGIN_STEP, patch);
    const result = await runBootstrap(d);
    expect(result.success).toBe(true);
    const session = sb.session();
    expect(session).toEqual({ mag: 'm-1', session: 's-2' });
  });
});

/** The scrape phase on a warm session, and the recovery call it would make. */
interface IWarmPhase {
  readonly scrape: ReturnType<typeof createApiDirectScrapePhase>;
  readonly ctx: IActionContext;
  readonly recover: jest.Mock<Promise<Procedure<string>>, []>;
}

/**
 * Report the session as warm.
 * @returns Always true.
 */
function reportWarm(): boolean {
  return true;
}

/**
 * Answer a re-login as successful.
 * @returns A resolved empty success.
 */
function recoverOk(): Promise<Procedure<string>> {
  const recovered = succeed('');
  return Promise.resolve(recovered);
}

/**
 * A patch that throws instead of answering.
 * @param thrown - The value to throw.
 * @returns A throwing patch.
 */
function throwingPatch(thrown: unknown): PatchFn {
  /**
   * Throw instead of answering.
   * @returns Never.
   */
  function patchThatThrows(): Procedure<SessionContextPatch> {
    throw thrown;
  }
  return jest.fn<Procedure<SessionContextPatch>, [IResponseSessionArgs]>(patchThatThrows);
}

/**
 * Build the real scrape phase on a warm session, so a failed scrape qualifies
 * for the recover-once re-login and the spy can see whether it was attempted.
 * @param patch - The response-session patch under test.
 * @returns The phase, its context and its recovery spy.
 */
function warmPhase(patch: PatchFn): IWarmPhase {
  const sb = makeSessionBus(OK_PLAN);
  const recover = jest.fn<Promise<Procedure<string>>, []>(recoverOk);
  const warm = { wasSessionWarm: reportWarm, recoverSession: recover };
  const bus: IApiMediator = { ...sb.bus, ...makeRecoverySessionStubs(), ...warm };
  const spec = sessionSpec(patch);
  const shape = { ...SYN_CASE.shape, bootstrap: LOGIN_STEP, responseSession: spec };
  return { scrape: createApiDirectScrapePhase(shape), ctx: ctxFor(bus), recover };
}

const PATCH_FAILURE = new Error('patch exploded');
const THROWN_VALUES = [
  { name: 'an Error', thrown: PATCH_FAILURE },
  { name: 'a string', thrown: 'patch exploded as text' },
  { name: 'a Symbol', thrown: Symbol('patch exploded') },
];
const THREW = 'shape responseSession.patch threw: Error';
const DATA_CALL_THREW = fail(ScraperErrorTypes.Generic, `balance ${THREW}`);
const BOOTSTRAP_THREW = fail(ScraperErrorTypes.Generic, `bootstrap ${THREW}`);
const REFUSED = fail(ScraperErrorTypes.Generic, 'balance bank status');

/**
 * An error whose message quotes the bank's answer and whose class name is
 * chosen by the thrower, as a hostile or careless patch might produce.
 * @returns The error.
 */
function leakyError(): Error {
  const leaky = new Error('token abc-123 in the answer');
  leaky.name = 'abc-123';
  return leaky;
}

describe('ApiDirectScrapeResponseSession/throwing patch', () => {
  it.each(THROWN_VALUES)(
    '[RST-1] fails a data call typed and commits nothing when the patch throws $name',
    async row => {
      const sb = makeSessionBus(OK_PLAN);
      const patch = throwingPatch(row.thrown);
      const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
      const result = await dispatchStep(args);
      expect(result).toEqual(DATA_CALL_THREW);
      const session = sb.session();
      expect(session).toBe(FIRST_SESSION);
    },
  );

  it('[RST-2] fails a bootstrap call typed when its patch throws', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = throwingPatch(PATCH_FAILURE);
    const d = bootDriver(sb, LOGIN_STEP, patch);
    const result = await runBootstrap(d);
    expect(result).toEqual(BOOTSTRAP_THREW);
  });

  it('[RST-3] never reports the thrown message or a thrown class name', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const leaky = leakyError();
    const patch = throwingPatch(leaky);
    const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
    const result = await dispatchStep(args);
    expect(result).toEqual(DATA_CALL_THREW);
  });

  it('[RST-4] keeps a refused patch distinct from a thrown one', async () => {
    const sb = makeSessionBus(OK_PLAN);
    const patch = makePatch(BANK_STATUS);
    const args = balanceArgs(sb.bus, { responseSession: sessionSpec(patch) });
    const result = await dispatchStep(args);
    expect(result).toEqual(REFUSED);
  });

  it('[RST-5] recovers once on a warm session when the patch throws', async () => {
    const patch = throwingPatch(PATCH_FAILURE);
    const { scrape, ctx, recover } = warmPhase(patch);
    await scrape(ctx);
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
