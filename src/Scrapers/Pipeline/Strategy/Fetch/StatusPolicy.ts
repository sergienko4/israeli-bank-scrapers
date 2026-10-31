/**
 * Status policy (N4) — a bank names the 2xx statuses it decides itself.
 * Checked after WAF classification and before the body is read: `empty`
 * answers `{}`, `fail` refuses with the log-safe URL and the status. A
 * document step skips `empty`, because its reader judges a 204 as an empty
 * document against the step's marker.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IResponseReading, StatusAction } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { HttpVerb } from './FetchStrategy.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

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
 * Refuse a status the bank marks `fail`, naming the request URL only.
 * @param answer - The answered call.
 * @returns Generic failure with the log-safe URL and the status.
 */
function refuseStatus<T>(answer: IAnswer): Procedure<T> {
  const safeUrl = safeUrlForLog(answer.url);
  const status = String(answer.response.status);
  return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} HTTP ${status}`);
}

/** Outcome per status action. */
const DECISIONS: Readonly<Record<StatusAction, Decide>> = {
  empty: emptyAnswer,
  fail: refuseStatus,
};

/**
 * The action the bank names for this answer's status, when it applies.
 * @param answer - The answered call.
 * @returns The action; none when unnamed, or `empty` on a document step.
 */
function actionFor(answer: IAnswer): Option<StatusAction> {
  const action = answer.reading.statusPolicy[answer.response.status];
  if (!action) return none();
  const isDocument = answer.reading.responseKind === 'document';
  if (isDocument && action === 'empty') return none();
  return some(action);
}

/**
 * Decide an answer under its bank's status policy.
 * @param answer - A 2xx answer that passed WAF classification.
 * @returns The decided outcome, or none to let the reader judge the body.
 */
function applyStatusPolicy<T>(answer: IAnswer): Option<Procedure<T>> {
  const action = actionFor(answer);
  if (!action.has) return none();
  const decided = DECISIONS[action.value]<T>(answer);
  return some(decided);
}

export type { IAnswer };
export { applyStatusPolicy, emptyAnswer };
