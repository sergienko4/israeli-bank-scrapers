/**
 * PersistentAuthEnvelope — the outer form every durable-state kind shares:
 * unpadded base64url over strict UTF-8 JSON with a plain-object root.
 *
 * <p>Every failure names only a category, never a value, because a state can
 * carry a bearer token, a device private key or a device id.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { JsonUnknownRecord } from '../../Types/JsonValue.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

/**
 * Encoded-length cap. Base64 maps 3 bytes to 4 characters, so 32 KiB of text
 * also bounds the decoded JSON at the 24 KiB the contract allows.
 */
const MAX_ENCODED_CHARS = 32 * 1024;

/**
 * Build the category-only failure every invalid state returns.
 * @param category - Field category that failed; never a value.
 * @returns Procedure failure.
 */
function invalidState(category: string): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, `persistent auth state invalid: ${category}`);
}

/**
 * Decode strict UTF-8 without throwing.
 * @param bytes - Raw bytes.
 * @returns Decoded text, or false on any invalid sequence.
 */
function tryDecodeUtf8(bytes: Buffer): string | false {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
}

/**
 * Unwrap the canonical unpadded base64url envelope into JSON text.
 * @param encoded - Opaque state as supplied by the caller.
 * @returns JSON text, or an `encoding` failure.
 */
function decodeEnvelope(encoded: string): Procedure<string> {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CHARS) return invalidState('encoding');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) return invalidState('encoding');
  const text = tryDecodeUtf8(bytes);
  if (text === false) return invalidState('encoding');
  return succeed(text);
}

/**
 * Parse JSON without throwing, keeping only a plain-object root.
 * @param text - JSON text.
 * @returns Parsed object, or false for a syntax error or non-object root.
 */
function tryParseObject(text: string): JsonUnknownRecord | false {
  try {
    const parsed = JSON.parse(text) as unknown;
    const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return isObject ? (parsed as JsonUnknownRecord) : false;
  } catch {
    return false;
  }
}

/**
 * Unwrap the envelope and parse its JSON object; fields are not checked.
 * @param encoded - Opaque state as supplied by the caller.
 * @returns The raw state object, or an `encoding`/`json` failure.
 */
function decodeStateObject(encoded: string): Procedure<JsonUnknownRecord> {
  const text = decodeEnvelope(encoded);
  if (!isOk(text)) return text;
  const raw = tryParseObject(text.value);
  if (raw === false) return invalidState('json');
  return succeed(raw);
}

/**
 * Serialise a state through its key whitelist into the envelope.
 * @param state - State object.
 * @param keys - Exact keys, in publication order.
 * @returns Opaque unpadded base64url text.
 */
function encodeStateObject(state: object, keys: readonly string[]): string {
  const json = JSON.stringify(state, [...keys]);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Whether the object has exactly the given keys — none missing, none extra.
 * @param raw - Parsed state object.
 * @param keys - The schema's exact keys.
 * @returns True when the key set matches.
 */
function hasExactKeySet(raw: JsonUnknownRecord, keys: readonly string[]): boolean {
  const present = Object.keys(raw);
  if (present.length !== keys.length) return false;
  return keys.every((key): boolean => Object.hasOwn(raw, key));
}

export { decodeStateObject, encodeStateObject, hasExactKeySet, invalidState };
