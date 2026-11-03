/**
 * HTML tag scanner — reads a page's start and end tags in one pass, the
 * way the proven login-form parser does: tag names lower-cased, attributes as
 * `attrsOf` reads them. Comments, declarations and the text of `script` and
 * `style` hold no tags, and a `<` that opens no markup is text. An unclosed
 * comment, tag or quoted value ends the scan, so no part of a page is read
 * twice.
 */

import { attrsOf, type HtmlAttrs } from './HtmlTags.attrs.js';

/** One tag of a page. */
interface IHtmlTag {
  /** A start tag, or an end tag. */
  readonly kind: 'start' | 'end';
  /** Tag name, lower-cased. */
  readonly name: string;
  /** Attributes; an end tag has none. */
  readonly attrs: HtmlAttrs;
}

/** What one read found, and where the next read starts. */
interface IRead {
  readonly tags: readonly IHtmlTag[];
  readonly next: number;
}

/** Reads the markup that opens at `at`; false when it never closes. */
type MarkupReader = (html: string, at: number) => IRead | false;

/** A markup kind: how it opens, and how it is read. */
interface IMarkupKind {
  readonly opens: RegExp;
  readonly read: MarkupReader;
}

/** Elements whose content is raw text, and what closes it. */
const RAW_TEXT_CLOSERS: ReadonlyMap<string, string> = new Map([
  ['script', String.raw`<\/script[\s/>]`],
  ['style', String.raw`<\/style[\s/>]`],
]);

/** A quoted value's opening, or the `>` that ends a start tag. */
const TAG_END = String.raw`=\s*["']|>`;

/** Where a tag name ends. */
const NAME_END = /[\s/]/u;

/** An end tag's attributes. */
const NO_ATTRS: HtmlAttrs = new Map();

/**
 * A reader that skips markup up to and past its closer.
 * @param closer - Text that closes the markup.
 * @param opener - Length of the text that opens it.
 * @returns Markup reader that finds no tags.
 */
function skipTo(closer: string, opener: number): MarkupReader {
  return (html: string, at: number): IRead | false => {
    const end = html.indexOf(closer, at + opener);
    return end < 0 ? false : { tags: [], next: end + closer.length };
  };
}

/**
 * How long a tag's name is.
 * @param text - The tag's text after `<` or `</`.
 * @returns The name's length.
 */
function nameLengthOf(text: string): number {
  const length = text.search(NAME_END);
  return length < 0 ? text.length : length;
}

/**
 * Read an end tag.
 * @param html - Page text.
 * @param at - Where its `</` is.
 * @returns The tag, or false when it never closes.
 */
function readEndTag(html: string, at: number): IRead | false {
  const end = html.indexOf('>', at + 2);
  if (end < 0) return false;
  const text = html.slice(at + 2, end);
  const nameLength = nameLengthOf(text);
  const name = text.slice(0, nameLength).toLowerCase();
  return { tags: [{ kind: 'end', name, attrs: NO_ATTRS }], next: end + 1 };
}

/**
 * Where a quoted value ends.
 * @param html - Page text.
 * @param found - The value's `=` and opening quote.
 * @returns Just past its closing quote, or the page's end when it never closes.
 */
function afterQuote(html: string, found: RegExpExecArray): number {
  const quote = found[0].slice(-1);
  const close = html.indexOf(quote, found.index + found[0].length);
  return close < 0 ? html.length : close + 1;
}

/**
 * Find the `>` that ends a start tag, past any quoted value.
 * @param html - Page text.
 * @param from - Where the tag's name starts.
 * @returns Where its `>` is, or -1 when it never closes.
 */
function startTagEnd(html: string, from: number): number {
  const search = new RegExp(TAG_END, 'gu');
  search.lastIndex = from;
  let found = search.exec(html);
  for (; found !== null && found[0] !== '>'; found = search.exec(html)) {
    search.lastIndex = afterQuote(html, found);
  }
  return found === null ? -1 : found.index;
}

/**
 * Where the next read starts after a start tag: past a raw-text element's
 * content, else just past the tag.
 * @param html - Page text.
 * @param name - Tag name.
 * @param from - Just past the tag.
 * @returns Where the content's end tag is, or the page's end when it has none.
 */
function rawTextEnd(html: string, name: string, from: number): number {
  const closer = RAW_TEXT_CLOSERS.get(name);
  if (closer === undefined) return from;
  const search = new RegExp(closer, 'giu');
  search.lastIndex = from;
  const found = search.exec(html);
  return found === null ? html.length : found.index;
}

/**
 * Read a start tag.
 * @param html - Page text.
 * @param at - Where its `<` is.
 * @returns The tag, or false when it never closes.
 */
function readStartTag(html: string, at: number): IRead | false {
  const end = startTagEnd(html, at + 1);
  if (end < 0) return false;
  const text = html.slice(at + 1, end);
  const nameLength = nameLengthOf(text);
  const name = text.slice(0, nameLength).toLowerCase();
  const attrsText = text.slice(nameLength);
  const attrs = attrsOf(attrsText);
  return { tags: [{ kind: 'start', name, attrs }], next: rawTextEnd(html, name, end + 1) };
}

/** Markup kinds, in the order they are tried. */
const MARKUP_KINDS: readonly IMarkupKind[] = [
  { opens: /^<!--/u, read: skipTo('-->', 4) },
  { opens: /^<[!?]/u, read: skipTo('>', 2) },
  { opens: /^<\/[a-z]/iu, read: readEndTag },
  { opens: /^<[a-z]/iu, read: readStartTag },
];

/**
 * Read the next markup from a point of the page.
 * @param html - Page text.
 * @param from - Where to look for the next `<`.
 * @returns What it holds, or false when the page has no more.
 */
function readAt(html: string, from: number): IRead | false {
  const at = html.indexOf('<', from);
  if (at < 0) return false;
  const head = html.slice(at, at + 4);
  const kind = MARKUP_KINDS.find((markup): boolean => markup.opens.test(head));
  if (kind === undefined) return { tags: [], next: at + 1 };
  return kind.read(html, at);
}

/**
 * Read a page's tags.
 * @param html - Page text.
 * @returns Its start and end tags, in page order.
 */
function scanHtmlTags(html: string): readonly IHtmlTag[] {
  const tags: IHtmlTag[] = [];
  for (let read = readAt(html, 0); read !== false; read = readAt(html, read.next)) {
    tags.push(...read.tags);
  }
  return tags;
}

export type { IHtmlTag };
export { scanHtmlTags };
