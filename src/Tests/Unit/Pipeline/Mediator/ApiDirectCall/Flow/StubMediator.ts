/**
 * StubMediator — lint-clean IApiMediator stub shared by the
 * ApiDirectCall unit tests. Produces a mediator whose apiPost
 * dequeues pre-scripted Procedures and records each call.
 * Zero bank knowledge. Used by RunStep / SmsOtpFlow /
 * TokenStrategyFromConfig / TokenStrategyLongTerm tests.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  IApiQueryOpts,
} from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Captured apiPost call — exposed to tests for assertion. */
interface IApiPostCapture {
  readonly url: WKUrlGroup;
  readonly body: Record<string, unknown>;
  readonly extraHeaders: Record<string, string> | undefined;
}

/** Args bundle for makeStubMediator — respects the 3-param ceiling. */
interface IStubMediatorArgs {
  /** Scripted responses; idx-th apiPost dequeues responses[idx]. */
  readonly responses: readonly Procedure<unknown>[];
  /** Output slot — tests inspect captures after the run. */
  readonly captures: IApiPostCapture[];
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
 * Shared apiGet stub — tests never call it; always unused.
 * @returns Unused generic failure.
 */
async function apiGetStub<T>(): Promise<Procedure<T>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, 'unused') as Procedure<T>;
}

/**
 * Shared apiQuery stub — tests never call it; always unused.
 * @returns Unused generic failure.
 */
async function apiQueryStub<T>(): Promise<Procedure<T>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, 'unused') as Procedure<T>;
}

/**
 * Build an apiPost closure that dequeues responses + records calls.
 * @param args - Bundled responses + capture slot.
 * @returns Dequeuing apiPost.
 */
function makeApiPost(args: IStubMediatorArgs): IApiMediator['apiPost'] {
  let idx = 0;
  return async <T>(
    url: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => {
    await Promise.resolve();
    args.captures.push({ url, body, extraHeaders: opts?.extraHeaders });
    const resp = args.responses[idx];
    idx += 1;
    return resp as Procedure<T>;
  };
}

/**
 * Build an IApiMediator whose apiPost dequeues pre-scripted
 * responses and records each call into the supplied captures array.
 * All other mediator methods are inert stubs.
 * @param args - Bundled responses + capture slot.
 * @returns IApiMediator suitable for unit testing.
 */
function makeStubMediator(args: IStubMediatorArgs): IApiMediator {
  return {
    setBearer: ackTrue,
    setRawAuth: ackTrue,
    withTokenResolver: ackTrue,
    withTokenStrategy: ackTrue,
    primeSession: makePrimeSession(args),
    apiPost: makeApiPost(args),
    apiGet: apiGetStub,
    apiQuery: apiQueryStub,
  };
}

export type { IApiPostCapture, IStubMediatorArgs };
export { makeStubMediator };
