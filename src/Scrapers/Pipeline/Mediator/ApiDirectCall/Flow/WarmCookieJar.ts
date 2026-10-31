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
 */

import { createHash } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IStoredCookie } from '../../../Types/Domain/CookieSession.js';
import type { JsonUnknown, JsonUnknownList, JsonUnknownRecord } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';

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
} as const;

type WarmJarRejection = keyof typeof WARM_JAR_REJECTIONS;

const TOKEN_PREFIX = 'v1.';
const ACCOUNT_TAG_CHARS = 16;

/** The JS type of every cookie field; also the field whitelist. */
const COOKIE_FIELD_TYPES: Readonly<Record<keyof IStoredCookie, 'string' | 'boolean' | 'number'>> = {
  name: 'string',
  value: 'string',
  domain: 'string',
  path: 'string',
  hostOnly: 'boolean',
  secure: 'boolean',
  expiresEpochS: 'number',
};

const COOKIE_FIELDS = Object.keys(COOKIE_FIELD_TYPES) as readonly (keyof IStoredCookie)[];

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
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return digest.slice(0, ACCOUNT_TAG_CHARS);
}

/**
 * Keep only the whitelisted cookie fields, in a fixed order.
 * @param cookie - Cookie as stored or decoded.
 * @returns The cookie's own fields.
 */
function projectCookie(cookie: IStoredCookie): IStoredCookie {
  const { name, value, domain, path, expiresEpochS } = cookie;
  const flags = { hostOnly: cookie.hostOnly, secure: cookie.secure };
  return { name, value, domain, path, ...flags, expiresEpochS };
}

/**
 * Whether a parsed value is a plain object.
 * @param value - Parsed value.
 * @returns True for a non-null, non-array object.
 */
function isRecordValue(value: JsonUnknown): value is JsonUnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a parsed value is a list.
 * @param value - Parsed value.
 * @returns True for an array.
 */
function isListValue(value: JsonUnknown): value is JsonUnknownList {
  return Array.isArray(value);
}

/**
 * Whether a parsed value carries every cookie field with its type.
 * @param value - Parsed list element.
 * @returns True for a well-typed cookie.
 */
function isStoredCookie(value: JsonUnknown): value is IStoredCookie {
  if (!isRecordValue(value)) return false;
  return COOKIE_FIELDS.every((field): boolean => typeof value[field] === COOKIE_FIELD_TYPES[field]);
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
  if (!token.startsWith(TOKEN_PREFIX)) return reject('prefix');
  const body = token.slice(TOKEN_PREFIX.length);
  const text = Buffer.from(body, 'base64url').toString('utf8');
  return succeed(text);
}

/**
 * Parse the body text without throwing.
 * @param text - Body JSON text.
 * @returns Parsed value, or the `json` rejection.
 */
function parseBody(text: string): Procedure<JsonUnknown> {
  try {
    const parsed = JSON.parse(text) as JsonUnknown;
    return succeed(parsed);
  } catch {
    return reject('json');
  }
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
 * Seal a jar for the given provider and account.
 * @param identity - Provider tag and account.
 * @param cookies - The jar, in creation order.
 * @returns A `v1.` token.
 */
function encodeWarmJar(identity: IWarmJarIdentity, cookies: StoredJar): string {
  const a = accountTag(identity.account);
  const envelope: IJarEnvelope = { p: identity.provider, a, c: cookies.map(projectCookie) };
  const json = JSON.stringify(envelope);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `${TOKEN_PREFIX}${body}`;
}

/**
 * Open a stored jar, checking in order: size, prefix, JSON, schema, provider,
 * account. Runs no network request.
 * @param token - Stored token.
 * @param expected - Expected provider, account and size limit.
 * @returns The cookies, or the first failing check's rejection.
 */
function decodeWarmJar(token: string, expected: IWarmJarExpectation): Procedure<StoredJar> {
  const text = unwrapBody(token, expected.maxChars);
  if (!isOk(text)) return text;
  const parsed = parseBody(text.value);
  if (!isOk(parsed)) return parsed;
  return checkEnvelope(parsed.value, expected);
}

export type { StoredJar };
export { decodeWarmJar, encodeWarmJar, WARM_JAR_REJECTIONS };
