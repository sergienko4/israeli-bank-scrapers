/**
 * WarmTokenParts — what every `v1.` warm token codec shares: the prefix, the
 * identity tag, the parsed-value guards, the stored-cookie record and the
 * body wrap. Each codec (`WarmCookieJar.ts`, `WarmCarryBundle.ts`) keeps its
 * own envelope, check order and rejection texts.
 */

import { createHash, createHmac } from 'node:crypto';

import type { IStoredCookie } from '../../../Types/Domain/CookieSession.js';
import type { JsonUnknown, JsonUnknownList, JsonUnknownRecord } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';

/** Every warm token version starts with this. */
const WARM_TOKEN_PREFIX = 'v1.';
const IDENTITY_TAG_CHARS = 16;

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
 * Digest a caller or bank key before using it as an HMAC key.
 * @param key - Non-empty tag key.
 * @returns The 32-byte SHA-256 digest of the key text.
 */
function tagKeyBytes(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

/**
 * Tag an identity without storing it. A key makes the tag an HMAC-SHA256
 * that only the same password or bank fallback reproduces; no key keeps the
 * legacy unkeyed SHA-256, so older tokens stay readable.
 * @param text - Identity text, already normalized by the codec.
 * @param key - Optional password or bank-configured fallback.
 * @returns First 16 hex chars of the digest.
 */
function identityTag(text: string, key = ''): string {
  if (key.length === 0) {
    const legacy = createHash('sha256').update(text, 'utf8').digest('hex');
    return legacy.slice(0, IDENTITY_TAG_CHARS);
  }
  const bytes = tagKeyBytes(key);
  const keyed = createHmac('sha256', bytes).update(text, 'utf8').digest('hex');
  return keyed.slice(0, IDENTITY_TAG_CHARS);
}

/**
 * Whether a stored tag matches the identity under the current key. The
 * legacy unkeyed tag is always accepted, so a token minted before keying
 * still opens once and is replaced with a keyed token on the next export.
 * @param tag - Stored tag.
 * @param text - Identity text, already normalized by the codec.
 * @param key - Password or bank-configured fallback; '' for none.
 * @returns True when the tag is the keyed or legacy digest.
 */
function identityMatches(tag: string, text: string, key = ''): boolean {
  if (tag === identityTag(text)) return true;
  if (key.length === 0) return false;
  return tag === identityTag(text, key);
}

/**
 * The normalized JSON array an account tag covers.
 * @param accounts - Account values; surrounding spaces ignored.
 * @returns The JSON text.
 */
function accountsJson(accounts: readonly string[]): string {
  const trimmed = accounts.map((account): string => account.trim());
  return JSON.stringify(trimmed);
}

/**
 * Tag account values without storing them.
 * @param accounts - Account values; surrounding spaces ignored.
 * @param key - Password or bank fallback key; '' keeps the legacy tag.
 * @returns The identity tag of their JSON array.
 */
function accountsTag(accounts: readonly string[], key = ''): string {
  const json = accountsJson(accounts);
  return identityTag(json, key);
}

/**
 * Whether a stored tag covers the expected accounts under the current key.
 * @param tag - Stored account tag.
 * @param accounts - Expected account values.
 * @param key - Password or bank fallback key; '' keeps the legacy tag.
 * @returns True for the keyed or legacy tag.
 */
function accountsMatch(tag: string, accounts: readonly string[], key = ''): boolean {
  const json = accountsJson(accounts);
  return identityMatches(tag, json, key);
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
 * A record's text at a key.
 * @param record - Parsed slots or a flow's carry.
 * @param key - Slot name.
 * @returns The text, or '' when absent or not a string.
 */
function textAt(record: Readonly<JsonUnknownRecord>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Wrap an envelope's JSON text as a token.
 * @param json - Envelope JSON text.
 * @returns `v1.` + unpadded base64url of its UTF-8 bytes.
 */
function wrapJsonText(json: string): string {
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `${WARM_TOKEN_PREFIX}${body}`;
}

/**
 * Parse a token's body text without throwing.
 * @param text - Body JSON text.
 * @param failure - The codec's rejection for unreadable JSON.
 * @returns Parsed value, or the failure.
 */
function parseJsonBody(text: string, failure: Procedure<never>): Procedure<JsonUnknown> {
  try {
    const parsed = JSON.parse(text) as JsonUnknown;
    return succeed(parsed);
  } catch {
    return failure;
  }
}

export {
  accountsMatch,
  accountsTag,
  identityMatches,
  identityTag,
  isListValue,
  isRecordValue,
  isStoredCookie,
  parseJsonBody,
  projectCookie,
  textAt,
  WARM_TOKEN_PREFIX,
  wrapJsonText,
};
