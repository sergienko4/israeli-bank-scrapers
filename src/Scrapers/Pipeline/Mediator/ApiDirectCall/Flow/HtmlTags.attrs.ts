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

/** One attribute: its name, then a double-quoted, single-quoted or bare value. */
const ATTR = /([^\s/>="']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;

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
 * Read one attribute.
 * @param found - The attribute's match.
 * @returns Its lower-cased name and its decoded value, or `true` for none.
 */
function attrOf(found: RegExpMatchArray): readonly [string, HtmlAttrValue] {
  const name = found[1].toLowerCase();
  const raw = found.at(2) ?? found.at(3) ?? found.at(4);
  if (raw === undefined) return [name, true];
  const value = raw.replaceAll(ENTITY, decodeEntity);
  return [name, value];
}

/**
 * Read a start tag's attributes.
 * @param text - The tag's text after its name.
 * @returns Its attributes; the last of duplicates wins.
 */
function attrsOf(text: string): HtmlAttrs {
  const found = text.matchAll(ATTR);
  const attrs = Array.from(found, attrOf);
  return new Map(attrs);
}

export type { HtmlAttrs, HtmlAttrValue };
export { attrsOf };
