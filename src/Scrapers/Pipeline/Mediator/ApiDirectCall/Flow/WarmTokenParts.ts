/**
 * WarmTokenParts — what every `v1.` warm token codec shares: the prefix, the
 * identity tag, the parsed-value guards, the stored-cookie record and the
 * body wrap. Each codec (`WarmCookieJar.ts`, `WarmCarryBundle.ts`) keeps its
 * own envelope, check order and rejection texts.
 */

import { createHash } from 'node:crypto';

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
 * Tag an identity without storing it.
 * @param text - Identity text, already normalized by the codec.
 * @returns First 16 hex chars of its SHA-256.
 */
function identityTag(text: string): string {
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return digest.slice(0, IDENTITY_TAG_CHARS);
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
