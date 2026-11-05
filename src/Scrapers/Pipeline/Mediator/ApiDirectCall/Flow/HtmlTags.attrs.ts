/**
 * Attributes of one HTML start tag (N37): names lower-cased, the last of
 * duplicates kept, values in double, single or no quotes, and `true` for an
 * attribute written without a value. A value decodes `&amp; &lt; &gt; &quot;`
 * and the decimal and hex character references; an invalid code point reads
 * as U+FFFD, and any other entity stays as written.
 */

/** An attribute's value; `true` for an attribute written without one. */
type HtmlAttrValue = string | true;

/** A tag's attributes by lower-cased name. */
type HtmlAttrs = ReadonlyMap<string, HtmlAttrValue>;

/** A quoted or bare assignment immediately after an attribute name. */
const ATTR_VALUE = /\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/uy;

/** One of the four named entities, or a decimal or hex character reference. */
const ENTITY = /&(?:amp|lt|gt|quot|#\d{1,8}|#[xX][\dA-Fa-f]{1,8});/gu;

/** The named entities and their text. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
]);

/** Largest Unicode code point. */
const MAX_CODE_POINT = 0x10_ff_ff;

/** First and last surrogate, which name no character. */
const SURROGATE_FIRST = 0xd8_00;
const SURROGATE_LAST = 0xdf_ff;

/** What an invalid character reference reads as. */
const REPLACEMENT = '\uFFFD';

/**
 * The code point a character reference names.
 * @param entity - `&#N;` or `&#xH;`.
 * @returns Its code point.
 */
function codePointOf(entity: string): number {
  const digits = entity.slice(2, -1);
  const isHex = digits.startsWith('x') || digits.startsWith('X');
  if (!isHex) return Number.parseInt(digits, 10);
  const hexDigits = digits.slice(1);
  return Number.parseInt(hexDigits, 16);
}

/**
 * The character a code point names.
 * @param code - Code point.
 * @returns Its character, or U+FFFD for 0, a surrogate or past U+10FFFF.
 */
function charOf(code: number): string {
  const isSurrogate = code >= SURROGATE_FIRST && code <= SURROGATE_LAST;
  if (code === 0 || code > MAX_CODE_POINT || isSurrogate) return REPLACEMENT;
  return String.fromCodePoint(code);
}

/**
 * Decode one entity.
 * @param entity - A named entity or a character reference.
 * @returns Its text.
 */
function decodeEntity(entity: string): string {
  const named = NAMED_ENTITIES.get(entity);
  if (named !== undefined) return named;
  const code = codePointOf(entity);
  return charOf(code);
}

/**
 * Decode a matched assignment.
 * @param found - Assignment immediately after the attribute name.
 * @returns Its decoded value.
 */
function decodeAttrValue(found: RegExpExecArray): string {
  const raw = found.at(1) ?? found.at(2) ?? found.at(3);
  if (raw === undefined) throw new TypeError('attribute assignment missing value');
  return raw.replaceAll(ENTITY, decodeEntity);
}

/**
 * Read one name and the assignment immediately after it, if any.
 * @param text - Tag text.
 * @param found - Attribute name match.
 * @returns Its name, value and the next unread position.
 */
function readAttr(text: string, found: RegExpExecArray): readonly [string, HtmlAttrValue, number] {
  const after = found.index + found[0].length;
  ATTR_VALUE.lastIndex = after;
  const matched = ATTR_VALUE.exec(text);
  const name = found[0].toLowerCase();
  const value = matched === null ? true : decodeAttrValue(matched);
  const end = matched === null ? after : ATTR_VALUE.lastIndex;
  return [name, value, end];
}

/**
 * Read a start tag's attributes.
 * @param text - The tag's text after its name.
 * @returns Its attributes; the last of duplicates wins.
 */
function attrsOf(text: string): HtmlAttrs {
  const attrs = new Map<string, HtmlAttrValue>();
  const names = /[^\s/>="']+/gu;
  for (let found = names.exec(text); found !== null; found = names.exec(text)) {
    const [name, value, end] = readAttr(text, found);
    attrs.set(name, value);
    names.lastIndex = end;
  }
  return attrs;
}

export type { HtmlAttrs, HtmlAttrValue };
export { attrsOf };
