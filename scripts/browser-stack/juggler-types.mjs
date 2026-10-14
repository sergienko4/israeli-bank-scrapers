/**
 * Type-expression grammar of a Juggler `Protocol.js`, evaluated over Babel
 * AST nodes — never executed.
 *
 * - types: object literals, `t.Boolean|String|Number|Any`, `t.Array(<type>)`,
 *   `t.Nullable(<type>)`, `t.Enum([<string>, …])`, `t.Recursive(X, 'Name')`,
 *   and references to a top-level const or an assigned `X.Name`;
 * - `t.Optional(<type>)` only as the value of an object field.
 *
 * Anything else throws {@link UnparseableSchemaError} with its line, so an
 * upstream syntax change fails the gate closed instead of hiding fields. The
 * statement level lives in `juggler-schema.mjs`.
 */

/**
 * @typedef {import('@babel/types').Node} AstNode
 * @typedef {import('@babel/types').CallExpression} CallExpression
 * @typedef {import('@babel/types').Expression} Expression
 * @typedef {import('@babel/types').Identifier} Identifier
 * @typedef {import('@babel/types').MemberExpression} MemberExpression
 * @typedef {import('@babel/types').ObjectExpression} ObjectExpression
 * @typedef {import('@babel/types').ObjectProperty} ObjectProperty
 * @typedef {import('@babel/types').StringLiteral} StringLiteral
 * @typedef {StringLiteral | import('@babel/types').BooleanLiteral} EnumLiteral
 * @typedef {AstNode | null | undefined} MaybeNode - A node, an array hole or an absent child.
 * @typedef {ObjectExpression['properties'][number]} LiteralMember - One object-literal member.
 * @typedef {ObjectProperty['value']} PropValue - Value of one object-literal property.
 * @typedef {CallExpression['arguments']} CallArgs - Arguments of one call.
 * @typedef {import('./juggler-schema.d.mts').SchemaType} SchemaType
 * @typedef {import('./juggler-schema.d.mts').IField} IField
 * @typedef {Extract<SchemaType, { t: 'Boolean' | 'String' | 'Number' | 'Any' }>} PrimitiveType
 * @typedef {Extract<SchemaType, { t: 'Ref' }>} RefType
 */

/**
 * Declaration index of one `Protocol.js`, shared with the statement level.
 *
 * @typedef {object} SchemaIndex
 * @property {Map<string, Expression>} decls - Value of every top-level `const X = {…}` and
 *   assigned `X.Name`, by name.
 * @property {Set<string>} namespaces - Every `X` of a top-level `const X = {}`.
 * @property {Map<string, SchemaType>} memo - Normalized type of every resolved name.
 * @property {Set<string>} active - Names being resolved (cycle guard).
 * @property {PropValue} [root] - Value of `protocol.domains`, once indexed.
 */

const PRIMITIVES = new Set(['Boolean', 'String', 'Number', 'Any']);

/** A construct outside the supported grammar, located by its 1-based line. */
export class UnparseableSchemaError extends Error {
  /**
   * @param {number} line - 1-based line of the offending node (0 when unknown).
   * @param {string} reason - What was found and what was expected.
   */
  constructor(line, reason) {
    super(`line ${line}: ${reason}`);
    this.name = 'UnparseableSchemaError';
    this.line = line;
  }
}

/** @returns {never} Always throws, located at `node`. */
function fail(/** @type {MaybeNode} */ node, /** @type {string} */ reason) {
  throw new UnparseableSchemaError(node?.loc?.start.line ?? 0, reason);
}

/**
 * Own property or undefined — field names such as `constructor` stay data.
 *
 * @template T
 * @param {Readonly<Record<string, T>> | undefined} obj - Map to read, if any.
 * @param {string} key - Property name.
 * @returns {T | undefined} The own value, else undefined.
 */
const own = (obj, key) => (obj !== undefined && Object.hasOwn(obj, key) ? obj[key] : undefined);

/** Name of a plain `t.<Name>` member expression, else undefined. */
function tMember(/** @type {MaybeNode} */ node) {
  if (node?.type !== 'MemberExpression' || node.computed) return undefined;
  if (node.object.type !== 'Identifier' || node.object.name !== 't') return undefined;
  return node.property.type === 'Identifier' ? node.property.name : undefined;
}

/** `X.Name` of a plain two-part member expression. */
function memberName(/** @type {MaybeNode} */ node) {
  const plain = node?.type === 'MemberExpression' && !node.computed;
  if (!plain || node.object.type !== 'Identifier' || node.property.type !== 'Identifier')
    fail(node, `expected X.Name, got ${node?.type}`);
  return `${node.object.name}.${node.property.name}`;
}

/** Key of a plain object property (identifier or string literal). */
function keyOf(/** @type {LiteralMember} */ prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) fail(prop, `unsupported ${prop.type}`);
  if (prop.key.type === 'Identifier') return prop.key.name;
  return prop.key.type === 'StringLiteral' ? prop.key.value : fail(prop, 'unsupported key');
}

/** `[key, valueNode]` pairs of an object literal; duplicate keys fail. */
function entriesOf(/** @type {MaybeNode} */ node) {
  if (node?.type !== 'ObjectExpression') fail(node, `expected an object literal`);
  /** @type {[string, PropValue][]} */
  const entries = node.properties.map((/** @type {LiteralMember} */ p) => [
    keyOf(p),
    /** @type {ObjectProperty} */ (p).value,
  ]);
  const keys = entries.map(([key]) => key);
  const dup = keys.find((key, i) => keys.indexOf(key) !== i);
  return dup === undefined ? entries : fail(node, `duplicate key ${dup}`);
}

/** String values of a `[…]` literal of plain strings. */
function stringsOf(/** @type {MaybeNode} */ node) {
  const ok = node?.type === 'ArrayExpression' && node.elements.every(isString);
  return ok
    ? node.elements.map(e => /** @type {StringLiteral} */ (e).value)
    : fail(node, 'expected [<string>…]');
}
/** @type {(node: MaybeNode) => node is StringLiteral} */
const isString = node => node?.type === 'StringLiteral';

/**
 * Literal kinds `t.Enum` may list. Camoufox ships `t.Enum(['mixed', true])`
 * (`axTypes.AXTree.checked`); Juggler matches with `indexOf`, so values keep
 * their JS type and `true` never equals `'true'`.
 *
 * @type {ReadonlySet<AstNode['type'] | undefined>}
 */
const ENUM_LITERALS = new Set(['StringLiteral', 'BooleanLiteral']);

/** Values of a `t.Enum([…])` list of string or boolean literals. */
function enumValuesOf(/** @type {MaybeNode} */ node) {
  const isLiteral = (/** @type {MaybeNode} */ e) => ENUM_LITERALS.has(e?.type);
  const ok = node?.type === 'ArrayExpression' && node.elements.every(isLiteral);
  return ok
    ? node.elements.map(e => /** @type {EnumLiteral} */ (e).value)
    : fail(node, 'expected [<string|boolean>…]');
}

/**
 * Resolve a named declaration once; a cycle without `t.Recursive` fails.
 *
 * @param {SchemaIndex} ix - Declaration index.
 * @param {string} name - `X` or `X.Name`.
 * @param {MaybeNode} [at] - Referencing node, to locate a failure.
 * @returns {SchemaType} The memoized normalized type.
 */
function named(ix, name, at) {
  const node = ix.decls.get(name) ?? fail(at, `unknown reference ${name}`);
  if (ix.memo.has(name)) return /** @type {SchemaType} */ (ix.memo.get(name));
  if (ix.active.has(name)) fail(at, `cyclic reference ${name} without t.Recursive`);
  ix.active.add(name);
  ix.memo.set(name, typeOf(node, ix));
  ix.active.delete(name);
  return /** @type {SchemaType} */ (ix.memo.get(name));
}

/**
 * One `t.<Name>(…)` builder: its arity, then the normalized type of its arguments.
 *
 * @typedef {(args: CallArgs, ix: SchemaIndex) => SchemaType} CallBuilder
 * @typedef {readonly [arity: number, build: CallBuilder]} CallRule
 */

/** `t.<Name>(…)` builders: arity, then the normalized type. */
const CALLS = Object.freeze(
  /** @satisfies {Record<string, CallRule>} */ ({
    Array: [
      1,
      (/** @type {CallArgs} */ [item], /** @type {SchemaIndex} */ ix) => ({
        t: 'Array',
        item: typeOf(item, ix),
      }),
    ],
    Nullable: [
      1,
      (/** @type {CallArgs} */ [inner], /** @type {SchemaIndex} */ ix) => ({
        t: 'Nullable',
        inner: typeOf(inner, ix),
      }),
    ],
    Enum: [1, (/** @type {CallArgs} */ [list]) => ({ t: 'Enum', values: enumValuesOf(list) })],
    Recursive: [
      2,
      (/** @type {CallArgs} */ args, /** @type {SchemaIndex} */ ix) => recursiveRef(args, ix),
    ],
  }),
);

/** @returns {RefType} `t.Recursive(X, 'Name')` → a Ref resolved later in its own schema. */
function recursiveRef(/** @type {CallArgs} */ [ns, name], /** @type {SchemaIndex} */ ix) {
  if (ns.type !== 'Identifier' || !isString(name)) fail(ns, 'expected t.Recursive(X, <string>)');
  const target = `${ns.name}.${name.value}`;
  return ix.decls.has(target)
    ? { t: 'Ref', ns: ns.name, name: name.value }
    : fail(ns, `unknown ${target}`);
}

/** @returns {SchemaType} Normalized type of a `t.<Name>(…)` call. */
function callType(/** @type {CallExpression} */ node, /** @type {SchemaIndex} */ ix) {
  const rule = own(CALLS, tMember(node.callee) ?? '');
  if (rule === undefined)
    fail(node, 'unsupported call (t.Optional is only allowed as a field value)');
  if (node.arguments.length !== rule[0]) fail(node, `expected ${rule[0]} argument(s)`);
  return rule[1](node.arguments, ix);
}

/** Normalized type of a `t.<Primitive>` or a reference to an assigned `X.Name`. */
function memberType(/** @type {MemberExpression} */ node, /** @type {SchemaIndex} */ ix) {
  const primitive = tMember(node);
  if (primitive === undefined) return named(ix, memberName(node), node);
  return PRIMITIVES.has(primitive)
    ? { t: /** @type {PrimitiveType['t']} */ (primitive) }
    : fail(node, `unsupported t.${primitive}`);
}

/** @typedef {'ObjectExpression' | 'MemberExpression' | 'Identifier' | 'CallExpression'} TypeKind */

/**
 * Normalized type of one expression kind, built from a node of that kind.
 *
 * @template {TypeKind} K
 * @typedef {(node: Extract<AstNode, { type: K }>, ix: SchemaIndex) => SchemaType} TypeRule
 */

/** Expression kind → normalized-type builder. */
const TYPE_OF = Object.freeze(
  /** @satisfies {{ [K in TypeKind]: TypeRule<K> }} */ ({
    ObjectExpression: (/** @type {ObjectExpression} */ node, /** @type {SchemaIndex} */ ix) => ({
      t: 'Object',
      fields: fieldsOf(node, ix),
    }),
    MemberExpression: memberType,
    Identifier: (/** @type {Identifier} */ node, /** @type {SchemaIndex} */ ix) =>
      named(ix, node.name, node),
    CallExpression: callType,
  }),
);

/** @returns {SchemaType} Normalized type of any supported expression. */
function typeOf(/** @type {MaybeNode} */ node, /** @type {SchemaIndex} */ ix) {
  const rule = own(TYPE_OF, node?.type ?? '');
  return rule === undefined
    ? fail(node, `unsupported expression ${node?.type}`)
    : /** @type {(node: MaybeNode, ix: SchemaIndex) => SchemaType} */ (rule)(node, ix);
}

/** One object field; `t.Optional(<type>)` marks it optional. */
function fieldOf(/** @type {PropValue} */ node, /** @type {SchemaIndex} */ ix) {
  if (node.type !== 'CallExpression' || tMember(node.callee) !== 'Optional')
    return { optional: false, type: typeOf(node, ix) };
  if (node.arguments.length !== 1) fail(node, 'expected 1 argument');
  return { optional: true, type: typeOf(node.arguments[0], ix) };
}

/** Field map of an object literal. */
function fieldsOf(/** @type {MaybeNode} */ node, /** @type {SchemaIndex} */ ix) {
  /** @type {[string, IField][]} */
  const entries = entriesOf(node).map(([key, value]) => [key, fieldOf(value, ix)]);
  return Object.fromEntries(entries);
}

export { entriesOf, fail, isString, memberName, named, own, stringsOf, typeOf };
