/**
 * Native fetch dispatch — sends a built run under its redirect policy, files
 * the answer's cookies and declared headers, then routes the response through
 * status, WAF, media-type and reader decisions. Logs are PII-safe: the URL is
 * stripped of query string before it reaches DEBUG.
 */

import { getDebug } from '../../Logging/Debug.js';
import type { IResponseReading, ResponseKind } from '../../Types/Domain/FetchPolicy.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { readDocument } from './DocumentResponse.js';
import { classifyHttpFailure, hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import { parseJsonResponse } from './JsonResponse.js';
import type { IRedirectRun, IRunEnd } from './RedirectFollow.js';
import { sendUnderPolicy } from './RedirectFollow.js';
import { emitSetCookies } from './RedirectShared.js';
import { emitResponseHeaders } from './ResponseHeaderSink.js';
import { refuseMediaType } from './ResponsePolicyCheck.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';
import { applyRateLimit, applyStatusPolicy, statusActionFor } from './StatusPolicy.js';
import { readText } from './TextResponse.js';

/** A run plus how its answer is read. */
interface IDispatch extends IRedirectRun {
  readonly reading: IResponseReading;
}

/** Reads a 2xx answer the status policy left undecided. */
type Reader = <T>(answer: IAnswer) => Promise<Procedure<T>>;

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Reader per response kind; each runs after WAF classification and the status policy. */
const READERS: Readonly<Record<ResponseKind, Reader>> = {
  json: parseJsonResponse,
  document: readDocument,
  text: readText,
};

/** Trace messages, one per dispatch checkpoint. */
const FIRE_MESSAGE = '[fetch] FIRE';
const FAIL_MESSAGE = '[fetch] NETWORK FAIL';
const STATUS_MESSAGE = '[fetch] STATUS';

/**
 * Whether an integrity-bounded answer is a header-only challenge.
 * @param answer - The answered call.
 * @param headers - The response's headers.
 * @returns True when the challenge body is not needed.
 */
function hasHeaderChallenge(answer: IAnswer, headers: Record<string, string>): boolean {
  if (answer.reading.responseIntegrity === undefined) return false;
  return hasCloudflareChallengeHeader(headers);
}

/**
 * Classify a failed or challenged answer into a Procedure failure.
 * @param answer - The answered call: non-2xx, or a 2xx challenge.
 * @returns WafBlocked for an edge refusal, else Generic honoring body omission.
 */
async function classifyStatus<T>(answer: IAnswer): Promise<Procedure<T>> {
  const { response, verb, url } = answer;
  const headers = Object.fromEntries(response.headers);
  const body = hasHeaderChallenge(answer, headers) ? '' : await response.text();
  const privacy = { omitBankText: answer.reading.omitBankText };
  const redaction = { redactUrlValues: answer.reading.redactUrlValues };
  const failure = { verb, url, status: response.status, body, headers, ...privacy, ...redaction };
  return classifyHttpFailure<T>(failure);
}

/**
 * Whether a Response carries an API body: a 2xx that is not an edge
 * challenge (Cloudflare does not tie its challenge header to a status).
 * @param response - The fetch Response returned by globalThis.fetch.
 * @returns True when the body should be read as the API's answer.
 */
function isApiSuccess(response: Response): boolean {
  if (!response.ok) return false;
  const headers = Object.fromEntries(response.headers);
  return !hasCloudflareChallengeHeader(headers);
}

/**
 * Route an answer: configured rate limits, WAF classification, remaining
 * status decisions, media type, and finally the configured reader.
 * @param answer - The answered call.
 * @returns Procedure with the read body or a classified failure.
 */
async function routeResponse<T>(answer: IAnswer): Promise<Procedure<T>> {
  const action = statusActionFor(answer);
  if (action.has && action.value === 'rate-limit') return applyRateLimit<T>(answer);
  if (!isApiSuccess(answer.response)) return classifyStatus<T>(answer);
  const decided = await applyStatusPolicy<T>(answer);
  if (decided.has) return decided.value;
  const refused = await refuseMediaType<T>(answer);
  if (refused.has) return refused.value;
  return READERS[answer.reading.responseKind]<T>(answer);
}

/**
 * Hand the final response to the call's hooks: its Set-Cookie lines go to the
 * cookie hook under the URL that answered, its declared headers and that URL
 * to the sink.
 * @param run - The dispatched run and its hooks.
 * @param end - The response that ended the run and the URL that answered.
 * @returns How many headers the call's header sink took.
 */
function emitHooks(run: IDispatch, end: IRunEnd): number {
  emitSetCookies(end.response, end.responseUrl, run.onSetCookie);
  return emitResponseHeaders(end.response, end.responseUrl, run.reading.headerSink);
}

/**
 * Record that a request is about to fire.
 * @param verb - Request verb.
 * @param url - URL already stripped of its query string.
 * @returns True once the trace is emitted.
 */
function logFire(verb: string, url: string): boolean {
  LOG.debug({ verb, url, message: FIRE_MESSAGE });
  return true;
}

/**
 * Record that the transport rejected a request.
 * @param run - The dispatched run.
 * @param url - URL already stripped of its query string.
 * @param failure - The transport's fixed failure.
 * @returns The same failure, so the caller can return it.
 */
function logNetworkFail(
  run: IDispatch,
  url: string,
  failure: IProcedureFailure,
): IProcedureFailure {
  LOG.debug({ verb: run.verb, url, errorMessage: failure.errorMessage, message: FAIL_MESSAGE });
  return failure;
}

/**
 * Record the answer's status.
 * @param verb - Request verb.
 * @param url - URL already stripped of its query string.
 * @param status - HTTP status.
 * @returns True once the trace is emitted.
 */
function logStatus(verb: string, url: string, status: number): boolean {
  LOG.debug({ verb, url, status, message: STATUS_MESSAGE });
  return true;
}

/**
 * Send a run under its redirect policy and route success/non-2xx through the
 * helpers. The final response's Set-Cookie lines are filed under the URL that
 * answered (manual hops file their own on the way) and its declared headers
 * reach the call's header sink. Emits PII-safe DEBUG traces at fire and
 * after-status. Per `logging-pii-guidlines.txt`, the URL is stripped of query
 * string (which may carry session ids / tokens) first.
 * @param run - url + init + verb + invoke transport + policies + cookie hooks.
 * @returns Procedure with parsed body or structured failure.
 */
async function dispatchFetch<T>(run: IDispatch): Promise<Procedure<T>> {
  const safeUrl = safeUrlForLog(run.url, run.redactUrlValues);
  logFire(run.verb, safeUrl);
  const sent = await sendUnderPolicy(run);
  if (!isOk(sent)) return logNetworkFail(run, safeUrl, sent);
  const response = sent.value.response;
  logStatus(run.verb, safeUrl, response.status);
  emitHooks(run, sent.value);
  return routeResponse<T>({ response, verb: run.verb, url: run.url, reading: run.reading });
}

export { dispatchFetch, isApiSuccess };
export type { IDispatch, Reader };
