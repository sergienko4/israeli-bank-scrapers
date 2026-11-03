/**
 * EnvelopeWire — the cipher and the shape checks shared by the envelope codec:
 * a JSON record guard, canonical base64 under a size cap, and an envelope's
 * header list. Each check answers `false` rather than naming what it saw.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import type { IJsonObject, JsonArray, JsonValue } from '../../../Types/JsonValue.js';

/** The envelope cipher. */
const CIPHER = 'aes-256-cbc';

/** IV length the envelope cipher takes. */
const IV_BYTES = 16;

/** Most base64 characters one wire value may hold (2 MiB of bytes). */
const MAX_BASE64_CHARS = 4_194_304;

/** Most headers one envelope may carry. */
const MAX_HEADERS = 16;

/**
 * Whether a JSON value is a record.
 * @param value - Any JSON value.
 * @returns True for a non-null, non-array object.
 */
function isJsonRecord(value: JsonValue): value is IJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The bytes of a non-empty, canonical base64 text within the cap.
 * @param value - Wire value.
 * @returns The bytes, or false when the value is not such a text.
 */
function canonicalBytes(value: JsonValue): Buffer | false {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > MAX_BASE64_CHARS) return false;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return false;
  return bytes;
}

/**
 * Whether a header list holds at most 16 records.
 * @param headers - Wire header list.
 * @returns True when every entry is a record and the list is short enough.
 */
function isHeaderList(headers: JsonArray): headers is readonly IJsonObject[] {
  if (headers.length > MAX_HEADERS) return false;
  return headers.every(isJsonRecord);
}

/**
 * An envelope's `headers`: an array of at most 16 records.
 * @param envelope - Envelope record.
 * @returns The header list, or false when it is malformed.
 */
function headerList(envelope: IJsonObject): readonly IJsonObject[] | false {
  const headers = envelope.headers;
  if (!Array.isArray(headers)) return false;
  const list: JsonArray = headers;
  if (!isHeaderList(list)) return false;
  return list;
}

/**
 * The headers of one type.
 * @param headers - Header list.
 * @param type - Header type.
 * @returns The matching headers, in order.
 */
function headersOfType(headers: readonly IJsonObject[], type: string): readonly IJsonObject[] {
  return headers.filter((header): boolean => header.type === type);
}

export { canonicalBytes, CIPHER, headerList, headersOfType, isJsonRecord, IV_BYTES };
