/**
 * Bounded, UTF-8-safe URL query text shared by derivation operations.
 */

import { isSafeText } from './RunStep.classify.checks.js';

const MAX_QUERY_URL_CHARS = 32_768;
const MAX_QUERY_VALUE_CHARS = 8_192;

/**
 * Whether a character is in the C1 control range.
 * @param unit - One character.
 * @returns True for a C1 control.
 */
function isC1Control(unit: string): boolean {
  const code = unit.codePointAt(0);
  return code !== undefined && code >= 0x80 && code <= 0x9f;
}

/**
 * Whether text is bounded, losslessly UTF-8 encodable and free of controls.
 * @param value - Candidate text.
 * @param maxChars - Longest allowed text.
 * @returns True for safe, nonempty text.
 */
function isQueryText(value: string, maxChars: number): boolean {
  if (!isSafeText(value, maxChars)) return false;
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) return false;
  return !Array.from(value).some(isC1Control);
}

/**
 * Whether a configured query key is safe and nonblank.
 * @param key - Query key.
 * @returns True for an admissible key.
 */
function isQueryKey(key: string): boolean {
  return isQueryText(key, MAX_QUERY_VALUE_CHARS) && key.trim() !== '';
}

/**
 * Refuses a malformed query escape without suppressing unrelated errors.
 * @param error - Decode failure.
 * @returns False for an invalid escape.
 */
function invalidEncoding(error: unknown): false {
  if (error instanceof URIError) return false;
  throw error;
}

/**
 * Whether percent-encoded query text is valid UTF-8.
 * @param search - URL search component.
 * @returns True when the encoding is valid.
 */
function hasValidEncoding(search: string): boolean {
  try {
    decodeURIComponent(search);
    return true;
  } catch (error) {
    return invalidEncoding(error);
  }
}

/**
 * Reads the only nonempty value of a configured key from a valid URL.
 * @param text - Source URL.
 * @param key - Query key.
 * @returns The decoded value, or false for unsafe or ambiguous input.
 */
function queryValue(text: string, key: string): string | false {
  if (!isQueryText(text, MAX_QUERY_URL_CHARS) || !isQueryKey(key)) return false;
  const url = URL.parse(text);
  if (url === null || !hasValidEncoding(url.search)) return false;
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !isQueryText(values[0], MAX_QUERY_VALUE_CHARS)) return false;
  return values[0];
}

export {
  hasValidEncoding,
  isQueryKey,
  isQueryText,
  MAX_QUERY_URL_CHARS,
  MAX_QUERY_VALUE_CHARS,
  queryValue,
};
