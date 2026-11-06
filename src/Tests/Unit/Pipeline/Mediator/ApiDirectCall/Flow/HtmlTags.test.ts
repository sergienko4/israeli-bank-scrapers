/**
 * The HTML tag scanner reads start and end tags the way the proven
 * parser does: tag and attribute names lower-cased, the last of duplicate
 * attributes kept, values in double, single or no quotes with the five named
 * and the numeric entities decoded. Comments, declarations and the text of
 * `script` and `style` hold no tags; an unclosed comment or quote ends the
 * scan.
 */

import {
  type IHtmlTag,
  scanHtmlTags,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/HtmlTags.js';

/** A tag as plain data: its kind, name and attributes. */
type TagShape = readonly [string, string, Readonly<Record<string, string | true>>];

/** One scan case: its label, page and expected tags. */
interface IScanCase {
  readonly label: string;
  readonly html: string;
  readonly expected: readonly TagShape[];
}

/**
 * A tag as plain data.
 * @param tag - Scanned tag.
 * @returns Its kind, name and attributes.
 */
function shapeOf(tag: IHtmlTag): TagShape {
  return [tag.kind, tag.name, Object.fromEntries(tag.attrs)];
}

/**
 * Scan a page into plain tags.
 * @param html - Page text.
 * @returns Its tags as plain data.
 */
function scan(html: string): readonly TagShape[] {
  return scanHtmlTags(html).map(shapeOf);
}

const CASES: readonly IScanCase[] = [
  {
    label: 'names lower-cased in every quote style',
    html: '<FORM ID="a" Method=post ACTION=\'x\'>',
    expected: [['start', 'form', { id: 'a', method: 'post', action: 'x' }]],
  },
  {
    label: 'an end tag with spaces',
    html: '<p></Form >',
    expected: [
      ['start', 'p', {}],
      ['end', 'form', {}],
    ],
  },
  {
    label: 'the named and numeric entities decoded',
    html: '<i v="a&amp;b&lt;&gt;&quot;&#39;&#65;&#x42;&#X43;">',
    expected: [['start', 'i', { v: 'a&b<>"\'ABC' }]],
  },
  {
    label: 'unknown and invalid entities',
    html: '<i a="&nbsp;&amp" b="&#0;&#x110000;&#xD800;">',
    expected: [['start', 'i', { a: '&nbsp;&amp', b: '\uFFFD\uFFFD\uFFFD' }]],
  },
  {
    label: 'a valueless attribute',
    html: '<input disabled name=a>',
    expected: [['start', 'input', { disabled: true, name: 'a' }]],
  },
  {
    label: 'the last duplicate attribute',
    html: '<input name=a NAME="b">',
    expected: [['start', 'input', { name: 'b' }]],
  },
  {
    label: 'a > inside a quoted value',
    html: '<input value="a>b" title=\'c>d\' name=x><br>',
    expected: [
      ['start', 'input', { value: 'a>b', title: 'c>d', name: 'x' }],
      ['start', 'br', {}],
    ],
  },
  {
    label: 'attribute-like text inside a quoted value',
    html: '<form note="name=spoof disabled" name=login>',
    expected: [['start', 'form', { note: 'name=spoof disabled', name: 'login' }]],
  },
  {
    label: 'spaces around = and a self-closing slash',
    html: '<input name = "a" value =b />',
    expected: [['start', 'input', { name: 'a', value: 'b' }]],
  },
  {
    label: 'comments and declarations',
    html: '<!DOCTYPE html><?xml x?><!-- <input name=c> --><input name=d>',
    expected: [['start', 'input', { name: 'd' }]],
  },
  {
    label: 'script and style text',
    html: "<script>var s = '<input name=s>';</SCRIPT ><style>i{}</style><input name=t>",
    expected: [
      ['start', 'script', {}],
      ['end', 'script', {}],
      ['start', 'style', {}],
      ['end', 'style', {}],
      ['start', 'input', { name: 't' }],
    ],
  },
  {
    label: 'text with a bare <',
    html: 'a < b <3 <input name=e>',
    expected: [['start', 'input', { name: 'e' }]],
  },
  {
    label: 'an unclosed comment',
    html: '<input name=f><!-- <input name=g>',
    expected: [['start', 'input', { name: 'f' }]],
  },
  {
    label: 'an unclosed quote',
    html: '<input name=f><input value="x><input name=g>',
    expected: [['start', 'input', { name: 'f' }]],
  },
  {
    label: 'an unclosed tag',
    html: '<input name=f><input name=g',
    expected: [['start', 'input', { name: 'f' }]],
  },
  {
    label: 'an unclosed script',
    html: '<script><input name=h>',
    expected: [['start', 'script', {}]],
  },
];

describe('scanHtmlTags', () => {
  it.each(CASES)('reads $label', ({ html, expected }) => {
    const tags = scan(html);
    expect(tags).toEqual(expected);
  });

  it('reads a large page in one pass', () => {
    const html = '<input type=hidden name=a value=b>'.repeat(20_000);
    const tags = scanHtmlTags(html);
    expect(tags).toHaveLength(20_000);
  });
});
