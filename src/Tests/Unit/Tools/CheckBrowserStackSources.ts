/**
 * CheckBrowserStackSources — tiny synthetic Juggler `Protocol.js` sources and
 * deltas, shared by the browser-stack parser and differ tests.
 *
 * <p>Every source has one domain `D` on line 3, so a case states only the
 * fields, prelude or statement it is about.
 */

import type { IJugglerDelta } from '../../../../scripts/browser-stack/juggler-diff.mjs';

const IMPORT_LINE = "const {t} = ChromeUtils.importESModule('resource://testing/t.js');";

/**
 * One type that only renames the next one in a chain.
 *
 * @param at - Its place in the chain.
 * @returns Its assignment.
 */
function chainLink(at: number): string {
  return `ns.A${String(at)} = t.Recursive(ns, 'A${String(at + 1)}');`;
}

/**
 * A namespace whose `A0` renames `A1`, and so on, the last one an object.
 *
 * @param length - How many types only rename the next.
 * @returns Prelude line.
 */
function aliasChain(length: number): string {
  const links = Array.from({ length }, (_, at) => chainLink(at));
  return `const ns = {}; ${links.join(' ')} ns.A${String(length)} = { v: t.String };`;
}

/**
 * A one-domain `Protocol.js` source. Lines: 1 import, 2 prelude, 3 domain `D`, 4 root.
 *
 * @param domain - Object literal of domain `D`.
 * @param prelude - Line 2: type namespaces, or a statement under test.
 * @returns Source text.
 */
function protocolOf(domain: string, prelude = ''): string {
  const root = 'export const protocol = { domains: { D } };';
  const lines = [IMPORT_LINE, prelude, `const D = ${domain};`, root];
  return lines.join('\n');
}

/**
 * Source whose domain `D` has one method `m`.
 *
 * @param params - Params object literal.
 * @param returns - Returns object literal.
 * @param prelude - Line 2 of the source.
 * @returns Source text.
 */
function method(params: string, returns = '{}', prelude = ''): string {
  return protocolOf(`{ methods: { m: { params: ${params}, returns: ${returns} } } }`, prelude);
}

/**
 * Source whose domain `D` has one event `e`.
 *
 * @param payload - Payload object literal.
 * @returns Source text.
 */
function event(payload: string): string {
  return protocolOf(`{ events: { e: ${payload} } }`);
}

/**
 * A delta written as the gate prints it.
 *
 * @param line - `<channel> <kind> <path>`.
 * @param signature - `src:<sig>|dst:<sig>`.
 * @returns The delta.
 */
function delta(line: string, signature: string): IJugglerDelta {
  const [channel, kind, path] = line.split(' ');
  return { channel, kind, path, signature } as IJugglerDelta;
}

export { aliasChain, delta, event, IMPORT_LINE, method, protocolOf };
