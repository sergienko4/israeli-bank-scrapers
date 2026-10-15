/**
 * Unit test for the Juggler schema parser and directional differ
 * (`scripts/browser-stack/juggler-*.mjs`).
 *
 * <p>The browser-stack gate decides whether a playwright-core release can talk
 * to the pinned Camoufox by diffing their `Protocol.js` schemas. Each case is
 * a pair of tiny synthetic sources that differ in one way, so a rule that is
 * too lax (misses the delta) and one that is too strict (reports a harmless
 * difference) both fail here. Upstream files are not vendored.
 *
 * <p>Sources are parsed, never executed: the rejected constructs below include
 * the ways a changed upstream file could run code or hide fields, and each
 * must fail closed with its line.
 */

import {
  compareDeltas,
  diffProtocols,
  type IJugglerDelta,
} from '../../../../scripts/browser-stack/juggler-diff.mjs';
import {
  type NormalizedSchema,
  parseJugglerSchema,
  type SchemaType,
  UnparseableSchemaError,
} from '../../../../scripts/browser-stack/juggler-schema.mjs';

const IMPORT_LINE = "const {t} = ChromeUtils.importESModule('resource://testing/t.js');";
const NO_DOMAINS = `${IMPORT_LINE}\nexport const protocol = { domains: {} };`;
const LEAF = 'const ns = {}; ns.Leaf = { v: t.String };';
const NODE = "const ns = {}; ns.Node = { v: t.String, kids: t.Array(t.Recursive(ns, 'Node')) };";
const NULLABLE_LEAF = 'const ns = {}; ns.Leaf = t.Nullable(t.String);';
const NESTED_LEAF = 'const ns = {}; ns.Leaf = t.Nullable(t.Nullable(t.String));';
const NEXT = "const ns = {}; ns.Node = { next: t.Recursive(ns, 'Node') };";
const NULLABLE_NEXT = "const ns = {}; ns.Node = { next: t.Nullable(t.Recursive(ns, 'Node')) };";
const KID = "const ns = {}; ns.P = { x: t.String, kid: t.Recursive(ns, 'P') };";
const NODE_NO_V = "const ns = {}; ns.Node = { kids: t.Array(t.Recursive(ns, 'Node')) };";
const SELF_NULLABLE = "const ns = {}; ns.A = t.Nullable(t.Recursive(ns, 'A'));";
const SELF_NESTED = "const ns = {}; ns.Node = t.Nullable(t.Nullable(t.Recursive(ns, 'Node')));";
const MUTUAL_ALIAS =
  "const ns = {}; ns.A = t.Nullable(t.Recursive(ns, 'B')); ns.B = t.Recursive(ns, 'A');";
const ALIAS_CHAIN =
  "const ns = {}; ns.A = t.Nullable(t.Recursive(ns, 'B')); ns.B = { v: t.String };";
const SELF_ARRAY = "const ns = {}; ns.A = t.Nullable(t.Array(t.Recursive(ns, 'A')));";

/**
 * Two namespaces that both declare `Node`; `A.Node` refers to `B.Node`.
 *
 * @param bNode - Object literal of `B.Node`.
 * @returns Prelude line.
 */
function twoNamespaces(bNode: string): string {
  return `const A = {}; const B = {}; B.Node = ${bNode}; A.Node = { b: t.Recursive(B, 'Node') };`;
}

const TWO_NS_B_HAS_V = twoNamespaces('{ v: t.String }');
const TWO_NS_B_EMPTY = twoNamespaces('{}');

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

/**
 * Line of the {@link UnparseableSchemaError} a source raises.
 *
 * @param text - Source to parse.
 * @returns The error's line; -1 when parsing succeeds, -2 on any other error.
 */
function thrownLine(text: string): number {
  try {
    parseJugglerSchema(text);
    return -1;
  } catch (error) {
    return error instanceof UnparseableSchemaError ? error.line : -2;
  }
}

/** A client/browser source pair and the exact deltas it must yield. */
interface IDiffCase {
  readonly id: string;
  readonly what: string;
  readonly client: string;
  readonly browser: string;
  readonly expected: readonly IJugglerDelta[];
}

const DIFF_CASES: readonly IDiffCase[] = [
  {
    id: 'BSD-1',
    what: 'request MISSING-METHOD',
    client: method('{ a: t.String, b: t.Optional(t.Number) }'),
    browser: protocolOf('{ methods: {} }'),
    expected: [delta('request MISSING-METHOD D.m', 'src:{a,b}|dst:absent')],
  },
  {
    id: 'BSD-2',
    what: 'request UNKNOWN-FIELD',
    client: method('{ a: t.String, b: t.Optional(t.Number) }'),
    browser: method('{ a: t.String }'),
    expected: [delta('request UNKNOWN-FIELD D.m.b', 'src:Optional(Number)|dst:absent')],
  },
  {
    id: 'BSD-3',
    what: 'request MISSING-REQUIRED-FIELD (absent in src)',
    client: method('{}'),
    browser: method('{ a: t.String }'),
    expected: [delta('request MISSING-REQUIRED-FIELD D.m.a', 'src:absent|dst:String')],
  },
  {
    id: 'BSD-4',
    what: 'request MISSING-REQUIRED-FIELD (optional in src)',
    client: method('{ a: t.Optional(t.String) }'),
    browser: method('{ a: t.String }'),
    expected: [delta('request MISSING-REQUIRED-FIELD D.m.a', 'src:Optional(String)|dst:String')],
  },
  {
    id: 'BSD-5',
    what: 'request ENUM-VALUE',
    client: method("{ a: t.Enum(['y', 'x']) }"),
    browser: method("{ a: t.Enum(['x']) }"),
    expected: [delta('request ENUM-VALUE D.m.a="y"', 'src:Enum("x"|"y")|dst:Enum("x")')],
  },
  {
    id: 'BSD-6',
    what: 'request NULLABLE',
    client: method('{ a: t.Nullable(t.String) }'),
    browser: method('{ a: t.String }'),
    expected: [delta('request NULLABLE D.m.a', 'src:String|dst:String')],
  },
  {
    id: 'BSD-7',
    what: 'request TYPE-MISMATCH (Array vs Object)',
    client: method('{ a: t.Array({ x: t.String }) }'),
    browser: method('{ a: { x: t.String } }'),
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Array(Object)|dst:{x}')],
  },
  {
    id: 'BSD-8',
    what: 'request TYPE-MISMATCH (String to Enum)',
    client: method('{ a: t.String }'),
    browser: method("{ a: t.Enum(['x']) }"),
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:String|dst:Enum("x")')],
  },
  {
    id: 'BSD-9',
    what: 'request TYPE-MISMATCH (Any to a specific type)',
    client: method('{ a: t.Any }'),
    browser: method('{ a: t.String }'),
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Any|dst:String')],
  },
  {
    id: 'BSD-10',
    what: 'return MISSING-REQUIRED-FIELD',
    client: method('{}', '{ r: t.String }'),
    browser: method('{}'),
    expected: [delta('return MISSING-REQUIRED-FIELD D.m.r', 'src:absent|dst:String')],
  },
  {
    id: 'BSD-11',
    what: 'return ENUM-VALUE',
    client: method('{}', "{ r: t.Enum(['a']) }"),
    browser: method('{}', "{ r: t.Enum(['a', 'b']) }"),
    expected: [delta('return ENUM-VALUE D.m.r="b"', 'src:Enum("a"|"b")|dst:Enum("a")')],
  },
  {
    id: 'BSD-12',
    what: 'return NULLABLE',
    client: method('{}', '{ r: t.Number }'),
    browser: method('{}', '{ r: t.Nullable(t.Number) }'),
    expected: [delta('return NULLABLE D.m.r', 'src:Number|dst:Number')],
  },
  {
    id: 'BSD-13',
    what: 'return TYPE-MISMATCH',
    client: method('{}', '{ r: t.Number }'),
    browser: method('{}', '{ r: t.String }'),
    expected: [delta('return TYPE-MISMATCH D.m.r', 'src:String|dst:Number')],
  },
  {
    id: 'BSD-14',
    what: 'event MISSING-EVENT',
    client: event('{ x: t.String }'),
    browser: protocolOf('{ events: {} }'),
    expected: [delta('event MISSING-EVENT D.e', 'src:absent|dst:{x}')],
  },
  {
    id: 'BSD-15',
    what: 'event MISSING-REQUIRED-FIELD',
    client: event('{ x: t.Number }'),
    browser: event('{}'),
    expected: [delta('event MISSING-REQUIRED-FIELD D.e.x', 'src:absent|dst:Number')],
  },
  {
    id: 'BSD-16',
    what: 'a nested object and array path',
    client: method('{ o: { a: t.Array({ k: t.String }) } }'),
    browser: method('{ o: { a: t.Array({}) } }'),
    expected: [delta('request UNKNOWN-FIELD D.m.o.a[].k', 'src:String|dst:absent')],
  },
  {
    id: 'BSD-17',
    what: 'a boolean enum value against its string spelling',
    client: method('{}', "{ r: t.Enum(['mixed', 'true']) }"),
    browser: method('{}', "{ r: t.Enum(['mixed', true]) }"),
    expected: [
      delta('return ENUM-VALUE D.m.r=true', 'src:Enum("mixed"|true)|dst:Enum("mixed"|"true")'),
    ],
  },
  {
    id: 'BSD-18',
    what: 'NULLABLE through a Ref, signed after resolution',
    client: method("{ a: t.Nullable(t.Recursive(ns, 'Leaf')) }", '{}', LEAF),
    browser: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', LEAF),
    expected: [delta('request NULLABLE D.m.a', 'src:{v}|dst:{v}')],
  },
  {
    id: 'BSD-19',
    what: 'a recursive difference once per depth, then stops',
    client: method('{ n: ns.Node }', '{}', NODE),
    browser: method('{ n: ns.Node }', '{}', NODE_NO_V),
    expected: [
      delta('request UNKNOWN-FIELD D.m.n.kids[].v', 'src:String|dst:absent'),
      delta('request UNKNOWN-FIELD D.m.n.v', 'src:String|dst:absent'),
    ],
  },
  {
    id: 'BSD-20',
    what: 'an optional and mistyped field, by kind',
    client: method('{ a: t.Optional(t.String) }'),
    browser: method('{ a: t.Number }'),
    expected: [
      delta('request MISSING-REQUIRED-FIELD D.m.a', 'src:Optional(String)|dst:Number'),
      delta('request TYPE-MISMATCH D.m.a', 'src:String|dst:Number'),
    ],
  },
  {
    id: 'BSD-21',
    what: 'a field named like an Object.prototype member',
    client: method('{ constructor: t.String }'),
    browser: method('{}'),
    expected: [delta('request UNKNOWN-FIELD D.m.constructor', 'src:String|dst:absent')],
  },
  {
    id: 'BSD-22',
    what: 'every method of a domain the browser lacks',
    client: protocolOf('{ methods: { n: { params: {} }, m: { params: { a: t.String } } } }'),
    browser: NO_DOMAINS,
    expected: [
      delta('request MISSING-METHOD D.m', 'src:{a}|dst:absent'),
      delta('request MISSING-METHOD D.n', 'src:{}|dst:absent'),
    ],
  },
  {
    id: 'BSD-43',
    what: 'a | inside an enum value, which cannot pose as two values',
    client: method("{ a: t.Enum(['a|b']) }"),
    browser: method("{ a: t.Enum(['a', 'b']) }"),
    expected: [delta('request ENUM-VALUE D.m.a="a|b"', 'src:Enum("a|b")|dst:Enum("a"|"b")')],
  },
  {
    id: 'BSD-46',
    what: 'a boolean enum value where a String is expected',
    client: method("{ a: t.Enum(['mixed', true]) }"),
    browser: method('{ a: t.String }'),
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Enum("mixed"|true)|dst:String')],
  },
  {
    id: 'BSD-47',
    what: 'a difference inside a same-named type of another namespace',
    client: method("{ n: t.Recursive(A, 'Node') }", '{}', TWO_NS_B_HAS_V),
    browser: method("{ n: t.Recursive(A, 'Node') }", '{}', TWO_NS_B_EMPTY),
    expected: [delta('request UNKNOWN-FIELD D.m.n.b.v', 'src:String|dst:absent')],
  },
  {
    id: 'BSD-48',
    what: 'a Ref signed with its namespace',
    client: method("{ a: t.Array(t.Recursive(B, 'Node')) }", '{}', TWO_NS_B_EMPTY),
    browser: method('{ a: t.String }'),
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Array(Ref(B.Node))|dst:String')],
  },
  {
    id: 'BSD-49',
    what: 'one NULLABLE for a Nullable Ref to a Nullable type',
    client: method("{ a: t.Nullable(t.Recursive(ns, 'Leaf')) }", '{}', NULLABLE_LEAF),
    browser: method('{ a: t.String }'),
    expected: [delta('request NULLABLE D.m.a', 'src:String|dst:String')],
  },
  {
    id: 'BSD-50',
    what: 'NULLABLE for a Ref to a Nullable type the browser takes bare',
    client: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', NULLABLE_LEAF),
    browser: method('{ a: t.String }'),
    expected: [delta('request NULLABLE D.m.a', 'src:String|dst:String')],
  },
  {
    id: 'BSD-51',
    what: 'NULLABLE one step into a recursion that entered through the same Ref pair',
    client: method("{ n: t.Recursive(ns, 'Node') }", '{}', NULLABLE_NEXT),
    browser: method("{ n: t.Recursive(ns, 'Node') }", '{}', NEXT),
    expected: [delta('request NULLABLE D.m.n.next', 'src:{next}|dst:{next}')],
  },
  {
    id: 'BSD-52',
    what: 'a field type of an inline object with the keys of one met before',
    client: method("{ a: t.Recursive(ns, 'P') }", '{}', KID),
    browser: method('{ a: { x: t.String, kid: { x: t.Number, kid: t.Any } } }'),
    expected: [delta('request TYPE-MISMATCH D.m.a.kid.x', 'src:String|dst:Number')],
  },
  {
    id: 'BSD-53',
    what: 'one NULLABLE for a Nullable nested in a Nullable',
    client: method('{ a: t.Nullable(t.Nullable(t.String)) }'),
    browser: method('{ a: t.String }'),
    expected: [delta('request NULLABLE D.m.a', 'src:String|dst:String')],
  },
  {
    id: 'BSD-54',
    what: 'one NULLABLE for a Ref to a nested Nullable type',
    client: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', NESTED_LEAF),
    browser: method('{ a: t.String }'),
    expected: [delta('request NULLABLE D.m.a', 'src:String|dst:String')],
  },
];

/**
 * Identity the gate matches an accepted delta by.
 *
 * @param d - A delta.
 * @returns Channel, kind, path and signature, joined.
 */
function identityOf(d: IJugglerDelta): string {
  return JSON.stringify([d.channel, d.kind, d.path, d.signature]);
}

/** A client/browser source pair that must yield no delta. */
interface INoDeltaCase {
  readonly what: string;
  readonly client: string;
  readonly browser: string;
}

const NO_DELTA_CASES: readonly INoDeltaCase[] = [
  {
    what: 'a browser-only optional param',
    client: method('{}'),
    browser: method('{ a: t.Optional(t.String) }'),
  },
  {
    what: 'an extra browser key in a return',
    client: method('{}', '{ r: t.String }'),
    browser: method('{}', '{ r: t.String, extra: t.Number }'),
  },
  {
    what: 'an extra browser key in an event',
    client: event('{ x: t.String }'),
    browser: event('{ x: t.String, extra: t.Number }'),
  },
  {
    what: 'Any on the destination',
    client: method('{ a: t.String }'),
    browser: method('{ a: t.Any }'),
  },
  {
    what: 'a string-only Enum to String',
    client: method("{ a: t.Enum(['x', 'y']) }"),
    browser: method('{ a: t.String }'),
  },
  {
    what: 'Nullable on both sides',
    client: method('{ a: t.Nullable(t.String) }'),
    browser: method('{ a: t.Nullable(t.String) }'),
  },
  {
    what: 'a self-recursive Ref',
    client: method('{ n: ns.Node }', '{}', NODE),
    browser: method('{ n: ns.Node }', '{}', NODE),
  },
  {
    what: 'a Ref to a Nullable type the browser takes Nullable',
    client: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', NULLABLE_LEAF),
    browser: method('{ a: t.Nullable(t.String) }'),
  },
  {
    what: 'a Nullable Ref to a Nullable type the browser takes Nullable',
    client: method("{ a: t.Nullable(t.Recursive(ns, 'Leaf')) }", '{}', NULLABLE_LEAF),
    browser: method('{ a: t.Nullable(t.String) }'),
  },
  {
    what: 'a Nullable the browser takes as a Ref to a Nullable type',
    client: method('{ a: t.Nullable(t.String) }'),
    browser: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', NULLABLE_LEAF),
  },
  {
    what: 'a self-recursive Ref Nullable on both sides',
    client: method("{ n: t.Recursive(ns, 'Node') }", '{}', NULLABLE_NEXT),
    browser: method("{ n: t.Recursive(ns, 'Node') }", '{}', NULLABLE_NEXT),
  },
  {
    what: 'a recursive Ref the browser takes as matching inline objects',
    client: method("{ a: t.Recursive(ns, 'P') }", '{}', KID),
    browser: method('{ a: { x: t.String, kid: { x: t.String, kid: t.Any } } }'),
  },
  {
    what: 'a Nullable the browser nests in a Nullable',
    client: method('{ a: t.Nullable(t.String) }'),
    browser: method('{ a: t.Nullable(t.Nullable(t.String)) }'),
  },
  {
    what: 'a nested Nullable the browser takes Nullable',
    client: method('{ a: t.Nullable(t.Nullable(t.String)) }'),
    browser: method('{ a: t.Nullable(t.String) }'),
  },
  {
    what: 'a Ref through a Nullable alias to an object the browser takes Nullable',
    client: method("{ a: t.Recursive(ns, 'A') }", '{}', ALIAS_CHAIN),
    browser: method('{ a: t.Nullable({ v: t.String }) }'),
  },
  {
    what: 'a self-recursive Nullable Array alias on both sides',
    client: method("{ a: t.Recursive(ns, 'A') }", '{}', SELF_ARRAY),
    browser: method("{ a: t.Recursive(ns, 'A') }", '{}', SELF_ARRAY),
  },
  {
    what: 'a Ref to a nested Nullable type the browser takes Nullable',
    client: method("{ a: t.Recursive(ns, 'Leaf') }", '{}', NESTED_LEAF),
    browser: method('{ a: t.Nullable(t.String) }'),
  },
  {
    what: 'a browser-only method and event',
    client: protocolOf('{ methods: {} }'),
    browser: protocolOf('{ methods: { m: { params: { a: t.String } } }, events: { e: {} } }'),
  },
];

/** A source outside the grammar and the line its error must carry. */
interface IUnparseableCase {
  readonly id: string;
  readonly what: string;
  readonly source: string;
  readonly line: number;
}

const UNPARSEABLE_CASES: readonly IUnparseableCase[] = [
  { id: 'BSD-30', what: 'a non-t call', source: method('{ a: foo.String() }'), line: 3 },
  { id: 'BSD-31', what: 'an IIFE', source: protocolOf('{}', '(function () {})();'), line: 2 },
  { id: 'BSD-32', what: 'a process.* read', source: method('{ a: process.env.T }'), line: 3 },
  { id: 'BSD-33', what: 'require', source: protocolOf('{}', "const fs = require('fs');"), line: 2 },
  { id: 'BSD-34', what: 'eval', source: method("{ a: eval('t.String') }"), line: 3 },
  {
    id: 'BSD-35',
    what: 'a template with an expression',
    source: method('{ a: t.Enum([`x${1}`]) }'),
    line: 3,
  },
  {
    id: 'BSD-36',
    what: 'an assignment to a non-namespace',
    source: protocolOf('{}', 'window.Name = {};'),
    line: 2,
  },
  {
    id: 'BSD-37',
    what: 'an assignment to a nested member',
    source: protocolOf('{}', 'const ns = {}; ns.a.b = {};'),
    line: 2,
  },
  {
    id: 'BSD-38',
    what: 't.Optional outside a field',
    source: protocolOf('{ methods: { m: { params: t.Optional({}) } } }'),
    line: 3,
  },
  {
    id: 'BSD-39',
    what: 'a cycle without t.Recursive',
    source: method('{ a: ns.A }', '{}', 'const ns = {}; ns.A = { b: ns.B }; ns.B = { a: ns.A };'),
    line: 2,
  },
  { id: 'BSD-40', what: 'a syntax error', source: protocolOf('{ methods: { m: } }'), line: 3 },
  {
    id: 'BSD-41',
    what: 'an import binding more than t',
    source: method('{}').replace('{t}', '{t, x}'),
    line: 1,
  },
  { id: 'BSD-42', what: 'no export const protocol', source: IMPORT_LINE, line: 0 },
  {
    id: 'BSD-55',
    what: 'a t.Recursive cycle through a Nullable alone',
    source: method("{ a: t.Recursive(ns, 'A') }", '{}', SELF_NULLABLE),
    line: 2,
  },
  {
    id: 'BSD-56',
    what: 'a t.Recursive cycle through nested Nullable layers',
    source: method("{ a: t.Recursive(ns, 'Node') }", '{}', SELF_NESTED),
    line: 2,
  },
  {
    id: 'BSD-57',
    what: 'a t.Recursive cycle across two names',
    source: method("{ a: t.Recursive(ns, 'A') }", '{}', MUTUAL_ALIAS),
    line: 2,
  },
  {
    id: 'BSD-58',
    what: 'an unused bare t.Recursive self-alias',
    source: method('{}', '{}', "const ns = {}; ns.A = t.Recursive(ns, 'A');"),
    line: 2,
  },
];

const LEAF_TYPE: SchemaType = {
  t: 'Object',
  fields: {
    v: { optional: false, type: { t: 'Nullable', inner: { t: 'Enum', values: ['x', true] } } },
  },
};

const NORMALIZED: NormalizedSchema = {
  domains: {
    D: {
      methods: { m: { params: { a: { optional: true, type: LEAF_TYPE } }, returns: {} } },
      events: { e: { k: { optional: false, type: { t: 'Ref', ns: 'ns', name: 'Leaf' } } } },
    },
  },
  namespaces: { ns: { Leaf: LEAF_TYPE } },
};

const NORMALIZED_SOURCE = protocolOf(
  "{ targets: ['page'], methods: { m: { params: { a: t.Optional(ns.Leaf) } } }, events: { e: { k: t.Recursive(ns, 'Leaf') } } }",
  "const ns = {}; ns.Leaf = { v: t.Nullable(t.Enum(['x', true])) };",
);

const MULTI_CLIENT = [
  IMPORT_LINE,
  'const B = { methods: { m: { params: { z: t.String }, returns: { r: t.Number } } }, events: { e: { x: t.Number } } };',
  'const A = { methods: { m: { params: { z: t.String } } }, events: { e: { x: t.Number } } };',
  'export const protocol = { domains: { B, A } };',
].join('\n');

const MULTI_BROWSER = [
  IMPORT_LINE,
  'const B = { methods: { m: { params: {} } }, events: { e: {} } };',
  'const A = { methods: { m: { params: {} } }, events: { e: {} } };',
  'export const protocol = { domains: { A, B } };',
].join('\n');

describe('Juggler directional diff', () => {
  it.each(DIFF_CASES)('[$id] reports $what', c => {
    const deltas = diffProtocols(c.client, c.browser);
    expect(deltas).toEqual(c.expected);
  });

  it('[BSD-44] keeps a boolean enum value apart from its string spelling', () => {
    const browser = method("{ a: t.Enum(['x']) }");
    const stringClient = method("{ a: t.Enum(['x', 'true']) }");
    const booleanClient = method("{ a: t.Enum(['x', true]) }");
    const asString = diffProtocols(stringClient, browser);
    const asBoolean = diffProtocols(booleanClient, browser);
    expect([asString.length, asBoolean.length]).toEqual([1, 1]);
    const identities = [...asString, ...asBoolean].map(identityOf);
    expect(new Set(identities).size).toBe(2);
  });

  it('[BSD-45] signs both sides of every ENUM-VALUE differently', () => {
    const deltas = DIFF_CASES.flatMap((c): IJugglerDelta[] => diffProtocols(c.client, c.browser));
    const enumDeltas = deltas.filter((d): boolean => d.kind === 'ENUM-VALUE');
    const sides = enumDeltas.map((d): string[] => d.signature.slice('src:'.length).split('|dst:'));
    expect(enumDeltas.length).toBeGreaterThan(3);
    for (const [src, dst] of sides) expect(src).not.toBe(dst);
  });

  it.each(NO_DELTA_CASES)('[BSD-23] reports nothing for $what', c => {
    const deltas = diffProtocols(c.client, c.browser);
    expect(deltas).toEqual([]);
  });

  it('[BSD-24] sorts output by channel, then path, then kind', () => {
    const deltas = diffProtocols(MULTI_CLIENT, MULTI_BROWSER);
    expect(deltas).toEqual([
      delta('request UNKNOWN-FIELD A.m.z', 'src:String|dst:absent'),
      delta('request UNKNOWN-FIELD B.m.z', 'src:String|dst:absent'),
      delta('return MISSING-REQUIRED-FIELD B.m.r', 'src:absent|dst:Number'),
      delta('event MISSING-REQUIRED-FIELD A.e.x', 'src:absent|dst:Number'),
      delta('event MISSING-REQUIRED-FIELD B.e.x', 'src:absent|dst:Number'),
    ]);
  });

  it('[BSD-25] compares paths by codepoint, not locale', () => {
    const expected = [
      delta('request MISSING-REQUIRED-FIELD D.m.B', 's'),
      delta('request MISSING-REQUIRED-FIELD D.m.a', 's'),
      delta('request TYPE-MISMATCH D.m.a', 's'),
      delta('return NULLABLE A.m.r', 's'),
      delta('event MISSING-EVENT A.e', 's'),
    ];
    const shuffled = [3, 4, 2, 0, 1].map(i => expected[i]);
    const sorted = shuffled.sort(compareDeltas);
    expect(sorted).toEqual(expected);
  });
});

describe('Juggler schema parser', () => {
  it('[BSD-26] normalizes params, returns, events and namespaces', () => {
    const schema = parseJugglerSchema(NORMALIZED_SOURCE);
    expect(schema).toEqual(NORMALIZED);
  });

  it.each(UNPARSEABLE_CASES)('[$id] rejects $what at line $line', c => {
    const line = thrownLine(c.source);
    expect(line).toBe(c.line);
  });
});
