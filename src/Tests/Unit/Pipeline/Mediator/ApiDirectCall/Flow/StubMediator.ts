/**
 * StubMediator — lint-clean IApiMediator stub shared by the
 * ApiDirectCall unit tests. Produces a mediator whose apiPost and
 * apiGet dequeue pre-scripted Procedures from one shared queue, in
 * call order, and record each call.
 * Zero bank knowledge. Used by RunStep / SmsOtpFlow /
 * TokenStrategyFromConfig / TokenStrategyLongTerm tests.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  IApiQueryOpts,
} from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { WKUrlOrLiteral } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Captured apiPost call — exposed to tests for assertion. */
interface IApiPostCapture {
  readonly url: WKUrlOrLiteral;
  readonly body: Record<string, unknown>;
  readonly extraHeaders: Record<string, string> | undefined;
  readonly query?: Record<string, string>;
}

/** Captured apiGet call — exposed to tests for assertion. */
interface IApiGetCapture {
  readonly url: WKUrlOrLiteral;
  readonly extraHeaders: Record<string, string> | undefined;
  readonly query: Record<string, string> | undefined;
  readonly hasCookieSink: boolean;
}

/** Args bundle for makeStubMediator — respects the 3-param ceiling. */
interface IStubMediatorArgs {
  /** Scripted responses; the idx-th apiPost or apiGet call dequeues responses[idx]. */
  readonly responses: readonly Procedure<unknown>[];
  /** Output slot — tests inspect captures after the run. */
  readonly captures: IApiPostCapture[];
  /** Optional output slot for apiGet calls. */
  readonly getCaptures?: IApiGetCapture[];
  /** Optional bearer the stub's primeSession resolves with (default: ""). */
  readonly primeBearer?: string;
  /** Optional override: when set, primeSession resolves this Procedure. */
  readonly primeSession?: Procedure<string>;
}

/**
 * Always-true boolean ack — satisfies the IApiMediator setter
 * methods without asserting anything.
 * @returns true
 */
function ackTrue(): true {
  return true;
}

/**
 * Always-false boolean ack — inert `wasSessionWarm` stub (cold session).
 * @returns false
 */
function ackFalse(): false {
  return false;
}

/**
 * Shared recoverSession stub — tests never call it; always unused.
 * @returns Unused generic failure.
 */
async function recoverSessionStub(): Promise<Procedure<string>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, 'unused');
}

/**
 * Build a primeSession closure from the optional configured bearer /
 * explicit procedure. Defaults to succeed('').
 * @param args - Stub args.
 * @returns IApiMediator primeSession function.
 */
function makePrimeSession(args: IStubMediatorArgs): IApiMediator['primeSession'] {
  return async (): Promise<Procedure<string>> => {
    await Promise.resolve();
    if (args.primeSession !== undefined) return args.primeSession;
    return succeed(args.primeBearer ?? '');
  };
}

/**
 * Shared apiQuery stub — tests never call it; always unused.
 * @returns Unused generic failure.
 */
async function apiQueryStub<T>(): Promise<Procedure<T>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, 'unused');
}

/** Hands out the next scripted response, shared by apiPost and apiGet. */
type Dequeue = () => Procedure<unknown>;

/**
 * Build the shared response cursor.
 * @param responses - Scripted responses, oldest first.
 * @returns Dequeue returning responses[idx] and advancing idx.
 */
function makeDequeue(responses: readonly Procedure<unknown>[]): Dequeue {
  let idx = 0;
  return (): Procedure<unknown> => {
    const resp = responses[idx];
    idx += 1;
    return resp;
  };
}

/**
 * Build an apiPost closure that dequeues responses + records calls.
 * @param args - Bundled responses + capture slot.
 * @param next - Shared response cursor.
 * @returns Dequeuing apiPost.
 */
function makeApiPost(args: IStubMediatorArgs, next: Dequeue): IApiMediator['apiPost'] {
  return async <T>(
    url: WKUrlOrLiteral,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => {
    await Promise.resolve();
    args.captures.push({ url, body, extraHeaders: opts?.extraHeaders, query: opts?.query });
    return next() as Procedure<T>;
  };
}

/**
 * Build an apiGet closure that dequeues responses + records calls.
 * @param args - Bundled responses + optional GET capture slot.
 * @param next - Shared response cursor.
 * @returns Dequeuing apiGet.
 */
function makeApiGet(args: IStubMediatorArgs, next: Dequeue): IApiMediator['apiGet'] {
  return async <T>(url: WKUrlOrLiteral, opts?: IApiQueryOpts): Promise<Procedure<T>> => {
    await Promise.resolve();
    const hasCookieSink = opts?.onSetCookie !== undefined;
    const capture = { url, extraHeaders: opts?.extraHeaders, query: opts?.query, hasCookieSink };
    args.getCaptures?.push(capture);
    return next() as Procedure<T>;
  };
}

/**
 * Build an IApiMediator whose apiPost and apiGet dequeue pre-scripted
 * responses and record each call into the supplied capture arrays.
 * All other mediator methods are inert stubs.
 * @param args - Bundled responses + capture slot.
 * @returns IApiMediator suitable for unit testing.
 */
function makeStubMediator(args: IStubMediatorArgs): IApiMediator {
  const sessionContext: Record<string, unknown> = {};
  const next = makeDequeue(args.responses);
  /**
   * Mock setSessionContext — folds the supplied context into the
   * shared slot so {@link getSessionContext} can read it back.
   * @param ctx - Partial context to merge.
   * @returns true to satisfy the IApiMediator ack contract.
   */
  function setSessionContext(ctx: Readonly<Record<string, unknown>>): boolean {
    Object.assign(sessionContext, ctx);
    return true;
  }
  /**
   * Mock getSessionContext — returns the shared sessionContext slot.
   * @returns Read-only view of the slot.
   */
  function getSessionContext(): Readonly<Record<string, unknown>> {
    return sessionContext;
  }
  return {
    setBearer: ackTrue,
    setRawAuth: ackTrue,
    setSessionContext,
    getSessionContext,
    withTokenResolver: ackTrue,
    withTokenStrategy: ackTrue,
    primeSession: makePrimeSession(args),
    setSessionWarm: ackTrue,
    wasSessionWarm: ackFalse,
    recoverSession: recoverSessionStub,
    apiPost: makeApiPost(args, next),
    apiGet: makeApiGet(args, next),
    apiQuery: apiQueryStub,
  };
}

export type { IApiGetCapture, IApiPostCapture, IStubMediatorArgs };
export { makeStubMediator };
