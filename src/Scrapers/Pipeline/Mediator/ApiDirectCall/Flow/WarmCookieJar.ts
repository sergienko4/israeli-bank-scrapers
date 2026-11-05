/**
 * WarmCookieJar — the warm token of a cookie-session bank. Such a bank has no
 * bearer to replay, so the token is the session jar itself.
 *
 * <p>Wire form: `v1.` + unpadded base64url over UTF-8 JSON `{p, a, c}` — the
 * provider tag, a 16-hex SHA-256 tag of the trimmed account (never the account
 * itself), and the cookies in creation order. Only the cookie fields of
 * {@link IStoredCookie} travel; anything else is dropped on both sides.
 *
 * <p>A token failing any check is refused with a reason from
 * {@link WARM_JAR_REJECTIONS} — never a value, as the jar holds a live session.
 * A blank account binds nothing, so no jar is encoded or opened for one.
 *
 * <p>The provider tag and account hash only stop one account's jar from being
 * replayed for another. They are not authentication: like every stored warm
 * token, the jar is a secret its caller keeps.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IStoredCookie } from '../../../Types/Domain/CookieSession.js';
import type { JsonUnknown } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import {
  identityTag,
  isListValue,
  isRecordValue,
  isStoredCookie,
  parseJsonBody,
  projectCookie,
  WARM_TOKEN_PREFIX,
  wrapJsonText,
} from './WarmTokenParts.js';

/** Who a jar belongs to. */
interface IWarmJarIdentity {
  readonly provider: string;
  readonly account: string;
}

/** Who a stored jar must belong to, and its size limit. */
interface IWarmJarExpectation extends IWarmJarIdentity {
  readonly maxChars: number;
}

/** A jar's cookies, in creation order. */
type StoredJar = readonly IStoredCookie[];

/** The decoded `v1` envelope. */
interface IJarEnvelope {
  readonly p: string;
  readonly a: string;
  readonly c: StoredJar;
}

/** Why a stored jar was refused — logged as-is, so never a value. */
const WARM_JAR_REJECTIONS = {
  size: 'token longer than maxTokenChars',
  prefix: 'not a v1 cookie-jar token',
  json: 'token body is not JSON',
  schema: 'token body is not a cookie jar',
  provider: 'token belongs to another provider',
  account: 'token belongs to another account',
  session: 'this run has no cookie session',
  unbound: 'no account to bind the token to',
} as const;

type WarmJarRejection = keyof typeof WARM_JAR_REJECTIONS;

/**
 * Refuse a stored jar with a reason only.
 * @param reason - Rejection key.
 * @returns Procedure failure.
 */
function reject(reason: WarmJarRejection): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, WARM_JAR_REJECTIONS[reason]);
}

/**
 * Tag an account without storing it.
 * @param account - Account the jar belongs to; surrounding spaces ignored.
 * @returns First 16 hex chars of its SHA-256.
 */
function accountTag(account: string): string {
  const normalized = account.trim();
  return identityTag(normalized);
}

/**
 * Whether a parsed value is a `v1` envelope.
 * @param value - Parsed token body.
 * @returns True for `{p: string, a: string, c: cookie[]}`.
 */
function isJarEnvelope(value: JsonUnknown): value is IJarEnvelope {
  if (!isRecordValue(value)) return false;
  const cookies = value.c;
  const isTagged = typeof value.p === 'string' && typeof value.a === 'string';
  return isTagged && isListValue(cookies) && cookies.every(isStoredCookie);
}

/**
 * Check the size and prefix, then unwrap the body text.
 * @param token - Stored token.
 * @param maxChars - Inclusive size limit.
 * @returns Body JSON text, or the rejection.
 */
function unwrapBody(token: string, maxChars: number): Procedure<string> {
  if (token.length > maxChars) return reject('size');
  if (!token.startsWith(WARM_TOKEN_PREFIX)) return reject('prefix');
  const body = token.slice(WARM_TOKEN_PREFIX.length);
  const text = Buffer.from(body, 'base64url').toString('utf8');
  return succeed(text);
}

/**
 * Check the envelope's shape, then whose jar it is.
 * @param value - Parsed token body.
 * @param expected - Expected provider and account.
 * @returns The cookies, or the first failing check's rejection.
 */
function checkEnvelope(value: JsonUnknown, expected: IWarmJarIdentity): Procedure<StoredJar> {
  if (!isJarEnvelope(value)) return reject('schema');
  if (value.p !== expected.provider) return reject('provider');
  if (value.a !== accountTag(expected.account)) return reject('account');
  const cookies = value.c.map(projectCookie);
  return succeed(cookies);
}

/**
 * Whether an account is blank, so a jar cannot be bound to it.
 * @param account - Account from the creds.
 * @returns True when empty or only whitespace.
 */
function isUnbound(account: string): boolean {
  return account.trim().length === 0;
}

/**
 * Encode a jar for the given provider and account.
 * @param identity - Provider tag and account.
 * @param cookies - The jar, in creation order.
 * @returns A `v1.` token, or the `unbound` rejection for a blank account.
 */
function encodeWarmJar(identity: IWarmJarIdentity, cookies: StoredJar): Procedure<string> {
  if (isUnbound(identity.account)) return reject('unbound');
  const a = accountTag(identity.account);
  const envelope: IJarEnvelope = { p: identity.provider, a, c: cookies.map(projectCookie) };
  const json = JSON.stringify(envelope);
  const token = wrapJsonText(json);
  return succeed(token);
}

/**
 * Open a stored jar, checking in order: an account to bind, size, prefix,
 * JSON, schema, provider, account. Runs no network request.
 * @param token - Stored token.
 * @param expected - Expected provider, account and size limit.
 * @returns The cookies, or the first failing check's rejection.
 */
function decodeWarmJar(token: string, expected: IWarmJarExpectation): Procedure<StoredJar> {
  if (isUnbound(expected.account)) return reject('unbound');
  const text = unwrapBody(token, expected.maxChars);
  if (!isOk(text)) return text;
  const failure = reject('json');
  const parsed = parseJsonBody(text.value, failure);
  if (!isOk(parsed)) return parsed;
  return checkEnvelope(parsed.value, expected);
}

export type { StoredJar };
export { decodeWarmJar, encodeWarmJar, WARM_JAR_REJECTIONS };
