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
  const name = call.call ?? call.queryTag;
  const answer = capture.seen.at(-1);
  if (answer === undefined) return fail(ScraperErrorTypes.Generic, `${name} response unseen`);
  const patch = spec.patch({ body: response.value, ...answer, ctx: call.ctx });
  const stored = storePatch(patch, call.bus, name);
  if (!isOk(stored)) return stored;
  return response;
}

export type { IAnswerCapture };
export { captureAnswer, readResponseSession };
