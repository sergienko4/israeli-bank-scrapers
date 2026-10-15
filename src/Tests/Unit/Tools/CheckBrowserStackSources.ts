/**
 * CheckBrowserStackSources — tiny synthetic Juggler `Protocol.js` sources and
 * deltas, shared by the browser-stack parser and differ tests.
 *
 * <p>Every source has one domain `D` on line 3, so a case states only the
 * fields, prelude or statement it is about.
 */

import type { IJugglerDelta } from '../../../../scripts/browser-stack/juggler-diff.mjs';

const IMPORT_LINE = "const {t} = ChromeUtils.importESModule('resource://testing/t.js');";

/** Types in a chain long enough to overflow a walk that recurses once per link. */
const CHAIN_LENGTH = 20_000;
/**
 * Time to parse or diff that chain: far above a walk that passes each link
 * once (under a second), far below one that walks it again from every link
 * (over a minute).
 */
const CHAIN_BUDGET_MS = 10_000;
/** The type a chain ends in unless a case names another. */
const CHAIN_END = '{ v: t.String }';

/**
 * How one type in a chain holds the next: the text around its reference,
 * and the step that adds to a delta path.
 */
interface IChainLink {
  readonly open: string;
  readonly close: string;
  readonly step: string;
}

/** Every way the grammar lets one named type hold the next. */
const CHAIN_LINKS = {
  rename: { open: '', close: '', step: '' },
  field: { open: '{ n: ', close: ' }', step: '.n' },
  item: { open: 't.Array(', close: ')', step: '[]' },
  nullable: { open: 't.Nullable(', close: ')', step: '' },
} as const satisfies Readonly<Record<string, IChainLink>>;

/** A key of {@link CHAIN_LINKS}. */
type ChainLinkName = keyof typeof CHAIN_LINKS;

/** Every key of {@link CHAIN_LINKS}. */
const CHAIN_LINK_NAMES = Object.keys(CHAIN_LINKS) as readonly ChainLinkName[];

/**
 * One type in a chain: `A<at>`, holding `A<at + 1>`.
 *
 * @param link - How it holds the next.
 * @param at - Its place in the chain.
 * @returns Its assignment.
 */
function chainLink(link: IChainLink, at: number): string {
  const next = `t.Recursive(ns, 'A${String(at + 1)}')`;
  return `ns.A${String(at)} = ${link.open}${next}${link.close};`;
}

/**
 * A namespace whose `A0` holds `A1`, and so on, the last one `end`.
 *
 * @param name - How each type holds the next.
 * @param length - How many types hold the next.
 * @param end - The last type.
 * @returns Prelude line.
 */
function typeChain(name: ChainLinkName, length: number, end = CHAIN_END): string {
  const links = Array.from({ length }, (_, at) => chainLink(CHAIN_LINKS[name], at));
  return `const ns = {}; ${links.join(' ')} ns.A${String(length)} = ${end};`;
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

export {
  CHAIN_BUDGET_MS,
  CHAIN_LENGTH,
  CHAIN_LINK_NAMES,
  CHAIN_LINKS,
  type ChainLinkName,
  delta,
  event,
  IMPORT_LINE,
  method,
  protocolOf,
  typeChain,
};
