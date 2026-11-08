/**
 * Parses a bounded compact JWT without claiming to verify its signature.
 */

import type { IJsonObject, JsonValue } from '../../../Types/JsonValue.js';
import { isPlainObject } from '../Envelope/JsonPointer.js';
import { hasDuplicateJsonKeys } from '../Parsing/JsonUnique.js';

const JWT_SEGMENTS = 3;
const BASE64URL = /^[\w-]+$/u;
const INVALID_UTF8 = 'ERR_ENCODING_INVALID_ENCODED_DATA';

/**
 * Whether a segment uses canonical unpadded base64url.
 * @param segment - Encoded segment.
 * @returns True for a nonempty canonical segment.
 */
function isCanonicalSegment(segment: string): boolean {
  if (!BASE64URL.test(segment)) return false;
  return Buffer.from(segment, 'base64url').toString('base64url') === segment;
}

/**
 * Refuses the Node decoder's invalid UTF-8 error across execution realms.
 * @param error - Decoder failure.
 * @returns False for invalid UTF-8.
 */
function utf8Failure(error: unknown): false {
  if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === INVALID_UTF8)
    return false;
  throw error;
}

/**
 * Decodes UTF-8, refusing invalid byte sequences.
 * @param bytes - Token segment bytes.
 * @returns Decoded text, or false for invalid UTF-8.
 */
function decodeUtf8(bytes: Uint8Array): string | false {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch (error) {
    return utf8Failure(error);
  }
}

/**
 * Decodes one UTF-8 JSON object with no ambiguous keys.
 * @param encoded - Canonical base64url segment.
 * @returns Its object, or false for an invalid shape.
 */
function decodeObject(encoded: string): IJsonObject | false {
  const bytes = Buffer.from(encoded, 'base64url');
  const text = decodeUtf8(bytes);
  if (text === false) return false;
  const parsed = JSON.parse(text) as JsonValue;
  if (!isPlainObject(parsed) || hasDuplicateJsonKeys(text)) return false;
  return parsed;
}

/**
 * Refuses expected decoding errors without disclosing token contents.
 * @param error - Decoding error.
 * @returns False for malformed data.
 */
function decodeFailure(error: unknown): false {
  if (error instanceof SyntaxError || error instanceof RangeError) {
    return false;
  }
  throw error;
}

/**
 * Parses one UTF-8 JSON object.
 * @param encoded - Canonical base64url segment.
 * @returns Its object, or false for malformed input.
 */
function jsonObject(encoded: string): IJsonObject | false {
  try {
    return decodeObject(encoded);
  } catch (error) {
    return decodeFailure(error);
  }
}

/**
 * Reads the payload of a structurally valid compact token.
 * @param token - Untrusted compact token.
 * @param maxChars - Inclusive token length bound.
 * @returns Parsed claims, or false for malformed input.
 */
function issuedJwtPayload(token: string, maxChars: number): IJsonObject | false {
  if (token.length === 0 || token.length > maxChars) return false;
  const parts = token.split('.');
  if (parts.length !== JWT_SEGMENTS || !parts.every(isCanonicalSegment)) return false;
  if (jsonObject(parts[0]) === false) return false;
  return jsonObject(parts[1]);
}

export default issuedJwtPayload;
export { issuedJwtPayload };
