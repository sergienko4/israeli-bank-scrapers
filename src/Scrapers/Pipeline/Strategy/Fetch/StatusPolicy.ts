/**
 * Status policy — a bank names its 2xx decisions and rate-limit statuses.
 * `empty` answers `{}`, `fail` refuses with the log-safe URL and the status,
 * and `rate-limit` reports WafBlocked without reading the body. A
 * document step skips `empty`, because its reader judges a 204 as an empty
 * document against the step's marker. HTTP 429 is always a rate limit, whatever
 * the bank's policy says, and its body is never read.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IResponseReading, StatusAction } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { HttpVerb } from './FetchStrategy.js';
import cancelResponseBody from './ResponseBody.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** The status every bank treats as a rate limit. */
const RATE_LIMIT_STATUS = 429;

/** One answered call, with how its transport reads it. */
interface IAnswer {
  readonly response: Response;
  readonly verb: HttpVerb;
  readonly url: string;
  readonly reading: IResponseReading;
}

/** Builds the outcome a status action decides. */
type Decide = <T>(answer: IAnswer) => Procedure<T>;

/**
 * The answer a caller sees when the body is not its business.
 * @returns Success carrying `{}`.
 */
function emptyAnswer<T>(): Procedure<T> {
  return succeed({} as T);
}

/**
 * Mark a policy-approved empty outcome without changing the Procedure payload.
 * @param answer - Answer whose body the bank's status policy discards.
 * @returns Success carrying `{}`, distinguishable from a parsed empty envelope by its hook.
 */
function emptyStatusAnswer<T>(answer: IAnswer): Procedure<T> {
  answer.reading.onEmptyResponse?.();
  return emptyAnswer<T>();
}

/**
 * Refuse a status the bank marks `fail`, naming the request URL only.
 * @param answer - The answered call.
 * @returns Generic failure with the log-safe URL and the status.
 */
function refuseStatus<T>(answer: IAnswer): Procedure<T> {
  const safeUrl = safeUrlForLog(answer.url, answer.reading.redactUrlValues);
  const status = String(answer.response.status);
  return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} HTTP ${status}`);
}

/**
 * Report a bank-configured rate limit without quoting its response.
 * @param answer - The answered call.
 * @returns Terminal rate-limit failure with a log-safe URL.
 */
function refuseRateLimit<T>(answer: IAnswer): Procedure<T> {
  const safeUrl = safeUrlForLog(answer.url, answer.reading.redactUrlValues);
  const status = String(answer.response.status);
  return fail(ScraperErrorTypes.WafBlocked, `${answer.verb} ${safeUrl} ${status}: rate limited`);
}

/** Outcome per status action. */
const DECISIONS: Readonly<Record<StatusAction, Decide>> = {
  empty: emptyStatusAnswer,
  fail: refuseStatus,
  'rate-limit': refuseRateLimit,
};

/**
 * The action this answer's status takes: a rate limit for 429, else the
 * bank's named action.
 * @param answer - The answered call.
 * @returns The action; none when unnamed, or `empty` on a document step.
 */
function statusActionFor(answer: Pick<IAnswer, 'response' | 'reading'>): Option<StatusAction> {
  if (answer.response.status === RATE_LIMIT_STATUS) return some('rate-limit');
  const action = answer.reading.statusPolicy[answer.response.status];
  if (!action) return none();
  const isDocument = answer.reading.responseKind === 'document';
  if (isDocument && action === 'empty') return none();
  return some(action);
}

/**
 * Decide an answer under its bank's status policy and release its unused body.
 * @param answer - A 2xx answer that passed WAF classification.
 * @returns The decided outcome, or none to let the reader judge the body.
 */
async function applyStatusPolicy<T>(answer: IAnswer): Promise<Option<Procedure<T>>> {
  const action = statusActionFor(answer);
  if (!action.has) return none();
  await cancelResponseBody(answer.response, answer);
  const decided = DECISIONS[action.value]<T>(answer);
  return some(decided);
}

/**
 * Apply the explicitly configured rate limit before reading a failed body.
 * @param answer - The rate-limited answer.
 * @returns The terminal failure.
 */
async function applyRateLimit<T>(answer: IAnswer): Promise<Procedure<T>> {
  await cancelResponseBody(answer.response, answer);
  return refuseRateLimit<T>(answer);
}

export type { IAnswer };
export { applyRateLimit, applyStatusPolicy, emptyAnswer, statusActionFor };
