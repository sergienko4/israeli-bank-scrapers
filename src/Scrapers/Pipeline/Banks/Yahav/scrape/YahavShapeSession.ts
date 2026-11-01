/**
 * Yahav native response session (spec §10.2, N31): every BaNCS answer is
 * gated on its envelope and rotates the security token, the CSRF token and
 * the two session ids. A value an answer leaves out or sends empty keeps the
 * previous one; a value that is not printable text fails the call, and so
 * does an answer after which any of the four is still missing — the login
 * included.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { SessionContext } from '../../../Mediator/Api/ApiMediator.js';
import { getIn, isRecord } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type {
  ApiBody,
  IResponseSessionArgs,
  IResponseSessionSpec,
  SessionContextPatch,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_ENVELOPE_VER } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import { fail, isOk, type Procedure, succeed } from '../../../Types/Procedure.js';
import { sessionText, YAHAV_SESSION_KEYS as KEYS, yahavSessionOf } from './YahavShapeHelpers.js';

/** The status codes BaNCS reports a completed call with. */
const OK_CODES: readonly unknown[] = [0, '0'];

/** Printable ASCII, bounded — what a token or session id may carry. */
const PRINTABLE = /^[\x20-\x7E]{1,32768}$/;

/** A rotated session id: its key, the header carrying it, the cookie prefix. */
interface IHeaderRule {
  readonly key: string;
  readonly header: string;
  readonly prefix: string;
}

/** The session ids each answer may rotate. */
const HEADER_RULES: readonly IHeaderRule[] = [
  { key: KEYS.session, header: 'jesessionid', prefix: 'JSESSIONID=' },
  { key: KEYS.xsrf, header: 'xsrf-token', prefix: 'XSRF-TOKEN=' },
];

/** The text values a complete session holds. */
const TEXT_KEYS: readonly string[] = [KEYS.csrf, KEYS.session, KEYS.xsrf];

/**
 * Fail the call with one session reason.
 * @param reason - Failure reason.
 * @returns The failure.
 */
function refuse<T>(reason: string): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, reason);
}

/**
 * Whether BaNCS completed the call: a 200, the envelope, a zero status code
 * and a payload whose entity list, when sent, is a list — an empty answer
 * leaves the list out.
 * @param args - The answer.
 * @returns True when accepted.
 */
function isAccepted(args: IResponseSessionArgs): boolean {
  if (args.status !== 200 || args.body.Ver !== YAHAV_ENVELOPE_VER) return false;
  const code = getIn(args.body, ['Status', 'Code']);
  const entities = getIn(args.body, ['Payload', 'DataEntity']);
  const isListed = entities === undefined || Array.isArray(entities);
  return OK_CODES.includes(code) && isRecord(args.body.Payload) && isListed;
}

/**
 * The security token: a newly issued one, else the previous one.
 * @param body - Answer body.
 * @param previous - Session before the answer.
 * @returns Security token.
 */
function rotatedSecurity(body: ApiBody, previous: SessionContext): unknown {
  const tokens = getIn(body, ['SecToken', 'Token']);
  const isIssued = Array.isArray(tokens) && tokens.length > 0;
  return isIssued ? body.SecToken : previous[KEYS.security];
}

/**
 * The CSRF token: a new printable one, else the previous one.
 * @param body - Answer body.
 * @param previous - Session before the answer.
 * @returns CSRF token, or the invalid-state failure.
 */
function rotatedCsrf(body: ApiBody, previous: SessionContext): Procedure<unknown> {
  const raw = body.csrfTkn;
  if (raw === undefined || raw === '') return succeed(previous[KEYS.csrf]);
  const isText = typeof raw === 'string' && PRINTABLE.test(raw);
  return isText ? succeed(raw) : refuse('session state invalid');
}

/**
 * One session id: the header's cookie value, else the previous id. An empty
 * header is the app's "no update", like an absent one.
 * @param rule - The id's rule.
 * @param headers - Answer headers.
 * @param previous - Session before the answer.
 * @returns Patch entry, or the invalid-state failure.
 */
function rotatedId(
  rule: IHeaderRule,
  headers: IResponseSessionArgs['headers'],
  previous: SessionContext,
): Procedure<SessionContextPatch> {
  const raw = headers[rule.header] as string | undefined;
  if (raw === undefined || raw === '') return succeed({ [rule.key]: previous[rule.key] });
  if (!PRINTABLE.test(raw)) return refuse('session state invalid');
  const bare = raw.replace(rule.prefix, '');
  return succeed({ [rule.key]: bare.split(';')[0] });
}

/**
 * Fold one rotated id into the ids so far, keeping the first failure.
 * @param ids - Ids rotated so far.
 * @param id - The next rotated id.
 * @returns The merged ids, or the first failure.
 */
function foldId(
  ids: Procedure<SessionContextPatch>,
  id: Procedure<SessionContextPatch>,
): Procedure<SessionContextPatch> {
  if (!isOk(ids)) return ids;
  if (!isOk(id)) return id;
  return succeed({ ...ids.value, ...id.value });
}

/**
 * Both session ids after the answer.
 * @param args - The answer.
 * @param previous - Session before the answer.
 * @returns Ids patch, or the invalid-state failure.
 */
function rotatedIds(
  args: IResponseSessionArgs,
  previous: SessionContext,
): Procedure<SessionContextPatch> {
  const ids = HEADER_RULES.map(rule => rotatedId(rule, args.headers, previous));
  const none: Procedure<SessionContextPatch> = succeed({});
  return ids.reduce(foldId, none);
}

/**
 * Pass a session holding all four values; fail one missing any.
 * @param state - Session after the answer.
 * @returns The state, or the missing-state failure.
 */
function completeState(state: SessionContextPatch): Procedure<SessionContextPatch> {
  const hasToken = isRecord(state[KEYS.security]);
  const hasTexts = TEXT_KEYS.every(key => sessionText(state, key) !== '');
  return hasToken && hasTexts ? succeed(state) : refuse('session state missing');
}

/**
 * The session patch one answer yields.
 * @param args - The answer.
 * @returns The four rotated values, or the call's failure.
 */
function rotateYahavSession(args: IResponseSessionArgs): Procedure<SessionContextPatch> {
  if (!isAccepted(args)) return refuse('bank status');
  const previous = yahavSessionOf(args.ctx);
  const csrf = rotatedCsrf(args.body, previous);
  if (!isOk(csrf)) return csrf;
  const ids = rotatedIds(args, previous);
  if (!isOk(ids)) return ids;
  const security = rotatedSecurity(args.body, previous);
  return completeState({ ...ids.value, security, csrf: csrf.value });
}

/** The headers every answer is read for, and the rotation they feed. */
const YAHAV_RESPONSE_SESSION: IResponseSessionSpec = {
  headers: HEADER_RULES.map(rule => rule.header),
  patch: rotateYahavSession,
};

export default YAHAV_RESPONSE_SESSION;
export { YAHAV_RESPONSE_SESSION };
