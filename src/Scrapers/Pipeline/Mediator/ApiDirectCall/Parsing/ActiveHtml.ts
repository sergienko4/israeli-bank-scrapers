/**
 * Collects active HTML elements without executing page content.
 */

import { type DefaultTreeAdapterTypes, html as htmlConstants, parse } from 'parse5';

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

const INERT_TAGS: ReadonlySet<string> = new Set(['template', 'noscript']);
const DEFAULT_SCRIPT_TYPE = 'text/javascript';
const JAVASCRIPT_TYPES: ReadonlySet<string> = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  DEFAULT_SCRIPT_TYPE,
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/**
 * Reads an HTML attribute.
 * @param node - Parsed HTML element.
 * @param name - Attribute name.
 * @returns Attribute text, or false when absent.
 */
function attribute(node: HtmlElement, name: string): string | false {
  return node.attrs.find(item => item.name === name)?.value ?? false;
}

/**
 * Whether an element and its descendants are active HTML.
 * @param node - Parsed element.
 * @returns True for a traversable HTML element.
 */
function isActive(node: HtmlElement): boolean {
  return node.namespaceURI === htmlConstants.NS.HTML && !INERT_TAGS.has(node.tagName);
}

/**
 * Adds one active node and queues its children in document order.
 * @param node - Parsed node.
 * @param pending - Remaining nodes.
 * @param elements - Collected active elements.
 * @returns The processed node.
 */
function collect(node: HtmlNode, pending: HtmlNode[], elements: HtmlElement[]): HtmlNode {
  if ('tagName' in node && !isActive(node)) return node;
  if ('tagName' in node) elements.push(node);
  if ('childNodes' in node) pending.push(...[...node.childNodes].reverse());
  return node;
}

/**
 * Walks the document in source order without traversing inert subtrees.
 * @param html - Untrusted document.
 * @returns Its active HTML elements.
 */
function activeElements(html: string): readonly HtmlElement[] {
  const pending: HtmlNode[] = [parse(html, { scriptingEnabled: true })];
  const elements: HtmlElement[] = [];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    collect(node, pending, elements);
  }
  return elements;
}

/**
 * Resolves the script type, including the obsolete language attribute.
 * @param node - Active HTML element.
 * @returns The lower-case type string.
 */
function scriptType(node: HtmlElement): string {
  const type = attribute(node, 'type');
  if (type !== false) return type === '' ? DEFAULT_SCRIPT_TYPE : type.toLowerCase();
  const language = attribute(node, 'language');
  return language === false || language === ''
    ? DEFAULT_SCRIPT_TYPE
    : `text/${language.toLowerCase()}`;
}

/**
 * Whether an obsolete classic-script event restriction allows execution.
 * @param node - Active classic script element.
 * @returns True when the script is not restricted away from the window load.
 */
function allowsEvent(node: HtmlElement): boolean {
  const target = attribute(node, 'for');
  const event = attribute(node, 'event');
  if (target === false || event === false) return true;
  const name = event.trim().toLowerCase();
  return target.trim().toLowerCase() === 'window' && ['onload', 'onload()'].includes(name);
}

/**
 * Trims explicit classic types without changing legacy language values.
 * @param node - Active script element.
 * @param type - Script type string.
 * @returns The classic type to match.
 */
function classicType(node: HtmlElement, type: string): string {
  if (attribute(node, 'type') === false) return type;
  return type.replaceAll(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '');
}

/**
 * Whether a script executes in a modern HTML document.
 * @param node - Active HTML element.
 * @returns True for a JavaScript or module script.
 */
function isExecutableScript(node: HtmlElement): boolean {
  if (node.tagName !== 'script') return false;
  const type = scriptType(node);
  if (type === 'module') return true;
  const classic = classicType(node, type);
  if (!JAVASCRIPT_TYPES.has(classic) || attribute(node, 'nomodule') !== false) return false;
  return allowsEvent(node);
}

/**
 * Returns a script's raw text nodes.
 * @param node - Active script element.
 * @returns Its unevaluated source.
 */
function scriptText(node: HtmlElement): string {
  const texts = node.childNodes.filter(
    (child): child is DefaultTreeAdapterTypes.TextNode => child.nodeName === '#text',
  );
  return texts.map(child => child.value).join('');
}

export { activeElements, attribute, isExecutableScript, scriptText };
