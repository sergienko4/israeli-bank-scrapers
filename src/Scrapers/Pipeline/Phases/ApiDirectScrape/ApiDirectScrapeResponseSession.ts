/**
 * Scrape response session: a shape's `responseSession` reads each
 * successful answer `dispatchStep` returns — the checked body, the declared
 * response headers (lower-case) and the HTTP status — and its patch is
 * merged into session-context before the call returns. The call's header
 * sink files every answer and the last one counts, so a call retried after
 * a 401 reads its final answer. A failed patch, a refused merge, or an
 * answer the sink never saw fails the call, named after it. Header values
 * are never logged.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { mergeSessionContext } from './ApiDirectScrapeSessionMerge.js';
import type {
  ApiBody,
  IResponseSessionSpec,
  SessionContextPatch,
} from './IApiDirectScrapeShape.js';
import { guardAnswerCallback } from './ShapeGuard.js';

/** One answer a call's header sink saw: its declared headers and status. */
interface ISeenAnswer {
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

/** A call's opts carrying the response-session sink, and the answers it filed. */
interface IAnswerCapture {
  readonly opts: IApiQueryOpts;
  readonly seen: ISeenAnswer[];
}

/** What reading a response session needs from the call that was sent. */
interface IResponseSessionCall {
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
  readonly queryTag: string;
  /** Name the call's failures carry; the query tag when absent. */
  readonly call?: string;
  readonly responseSession?: IResponseSessionSpec;
}

/** What reading one answer's session needs: the sink, its spec and the call. */
interface ISessionRead {
  readonly response: ApiBody;
  readonly capture: IAnswerCapture;
  readonly spec: IResponseSessionSpec;
  readonly call: IResponseSessionCall;
}

/**
 * File one answer the sink saw; the last one filed is the final answer.
 * @param seen - The call's filed answers.
 * @param headers - The declared headers the answer carried.
 * @param status - HTTP status of the answer.
 * @returns How many headers the answer carried.
 */
function keepAnswer(
  seen: ISeenAnswer[],
  headers: Readonly<Record<string, string>>,
  status: number,
): number {
  seen.push({ headers, status });
  return Object.keys(headers).length;
}

/**
 * Give a call's opts a header sink for the response session, when the
 * shape declares one; otherwise the opts pass through as they are.
 * @param opts - The step's opts.
 * @param spec - The shape's response session, if any.
 * @returns The opts to send and the answers their sink files.
 */
function captureAnswer(opts: IApiQueryOpts, spec?: IResponseSessionSpec): IAnswerCapture {
  const seen: ISeenAnswer[] = [];
  if (spec === undefined) return { opts, seen };
  const names = spec.headers.map((name): string => name.toLowerCase());
  const take = keepAnswer.bind(null, seen);
  const policy = { ...opts.policy, headerSink: { names, take } };
  return { opts: { ...opts, policy }, seen };
}

/**
 * Store a response-session patch, failing the call by name when the patch
 * failed or the mediator refused the merge.
 * @param patch - The patch the shape built.
 * @param bus - Mediator whose session-context is patched.
 * @param name - Name the call's failures carry.
 * @returns Void procedure, or the named failure.
 */
function storePatch(
  patch: Procedure<SessionContextPatch>,
  bus: IApiMediator,
  name: string,
): Procedure<void> {
  if (!isOk(patch)) return fail(patch.errorType, `${name} ${patch.errorMessage}`);
  const wasStored = mergeSessionContext(bus, patch.value);
  if (!wasStored) return fail(ScraperErrorTypes.Generic, `${name} session patch refused`);
  return succeed(undefined);
}

/**
 * Read the response session of a successful, checked answer. A failed
 * answer, or a shape with no response session, passes through unchanged.
 * @param response - The call's checked result.
 * @param capture - The answers the call's sink filed.
 * @param call - The call that was sent.
 * @returns The response, or the call's named failure.
 */
function readResponseSession(
  response: Procedure<ApiBody>,
  capture: IAnswerCapture,
  call: IResponseSessionCall,
): Procedure<ApiBody> {
  const spec = call.responseSession;
  if (!isOk(response) || spec === undefined) return response;
  const stored = applySessionPatch({ response: response.value, capture, spec, call });
  return isOk(stored) ? response : stored;
}

/**
 * Name a call whose header sink never filed an answer.
 * @param name - The call's name.
 * @returns The call's named response-unseen failure.
 */
function unseenAnswer(name: string): Procedure<void> {
  return fail(ScraperErrorTypes.Generic, `${name} response unseen`);
}

/**
 * Build the session patch from the call's final answer and store it.
 * @param input - The checked body, the sink's answers, the spec and the call.
 * @returns Void procedure, or the call's named failure.
 */
function applySessionPatch(input: ISessionRead): Procedure<void> {
  const { response, capture, spec, call } = input;
  const name = call.call ?? call.queryTag;
  const answer = capture.seen.at(-1);
  if (answer === undefined) return unseenAnswer(name);
  const patch = guardAnswerCallback('responseSession.patch', () =>
    spec.patch({ body: response, ...answer, ctx: call.ctx }),
  );
  return storePatch(patch, call.bus, name);
}

export type { IAnswerCapture };
export { captureAnswer, readResponseSession };
