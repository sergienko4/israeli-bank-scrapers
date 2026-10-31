/**
 * ISO-8859-1 form encoding (N23) — Java's `URLEncoder.encode(s, "ISO-8859-1")`
 * byte for byte: `A-Z a-z 0-9 . - * _` stay, a space becomes `+`, every other
 * char becomes `%XX` of its latin1 byte (uppercase hex). A char above U+00FF
 * has no latin1 byte, so the whole form is refused before any request.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { LATIN1_UNENCODABLE_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Highest code point ISO-8859-1 encodes. */
const LATIN1_MAX = 0xff;

/** Chars URLEncoder leaves as they are. */
const UNRESERVED = /^[\w.*-]$/;

/** One form field: name and text value. */
type FormPair = readonly [string, string];

/**
 * Encode one latin1 char.
 * @param char - A single char at or below U+00FF.
 * @returns The char, `+`, or `%XX`.
 */
function encodeChar(char: string): string {
  if (char === ' ') return '+';
  if (UNRESERVED.test(char)) return char;
  const hex = char.charCodeAt(0).toString(16).toUpperCase();
  return `%${hex.padStart(2, '0')}`;
}

/**
 * Whether every char of a text has a latin1 byte.
 * @param text - Field name or value.
 * @returns True when no char is above U+00FF.
 */
function isLatin1(text: string): boolean {
  return Array.from(text).every((char): boolean => char.charCodeAt(0) <= LATIN1_MAX);
}

/**
 * Encode one latin1 text.
 * @param text - Field name or value, already checked by {@link isLatin1}.
 * @returns The encoded text.
 */
function encodeText(text: string): string {
  return Array.from(text, encodeChar).join('');
}

/**
 * Encode one form field as `name=value`.
 * @param pair - Field name and text value, both latin1.
 * @returns The encoded field.
 */
function encodePair(pair: FormPair): string {
  const [name, value] = pair;
  const encodedName = encodeText(name);
  const encodedValue = encodeText(value);
  return `${encodedName}=${encodedValue}`;
}

/**
 * Encode form pairs as an ISO-8859-1 form body, in pair order.
 * @param pairs - Field names and text values.
 * @returns The body, or a Generic failure naming the encoding only.
 */
function encodeLatin1Form(pairs: readonly FormPair[]): Procedure<string> {
  const texts = pairs.flat();
  if (!texts.every(isLatin1)) return fail(ScraperErrorTypes.Generic, LATIN1_UNENCODABLE_REASON);
  const fields = pairs.map(encodePair);
  const body = fields.join('&');
  return succeed(body);
}

export default encodeLatin1Form;
export { encodeLatin1Form };
