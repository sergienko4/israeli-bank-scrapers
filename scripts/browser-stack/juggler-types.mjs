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
function fail(/** @type {any} */ node, /** @type {string} */ reason) {
  throw new UnparseableSchemaError(node?.loc?.start.line ?? 0, reason);
}

/** Own property or undefined — field names such as `constructor` stay data. */
const own = (/** @type {any} */ obj, /** @type {string} */ key) =>
  obj !== undefined && Object.hasOwn(obj, key) ? obj[key] : undefined;

/** Name of a plain `t.<Name>` member expression, else undefined. */
function tMember(/** @type {any} */ node) {
  if (node?.type !== 'MemberExpression' || node.computed) return undefined;
  if (node.object.type !== 'Identifier' || node.object.name !== 't') return undefined;
  return node.property.type === 'Identifier' ? node.property.name : undefined;
}

/** `X.Name` of a plain two-part member expression. */
function memberName(/** @type {any} */ node) {
  const plain = node?.type === 'MemberExpression' && !node.computed;
  if (!plain || node.object.type !== 'Identifier' || node.property.type !== 'Identifier')
    fail(node, `expected X.Name, got ${node?.type}`);
  return `${node.object.name}.${node.property.name}`;
}

/** Key of a plain object property (identifier or string literal). */
function keyOf(/** @type {any} */ prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) fail(prop, `unsupported ${prop.type}`);
  if (prop.key.type === 'Identifier') return prop.key.name;
  return prop.key.type === 'StringLiteral' ? prop.key.value : fail(prop, 'unsupported key');
}

/** `[key, valueNode]` pairs of an object literal; duplicate keys fail. */
function entriesOf(/** @type {any} */ node) {
  if (node?.type !== 'ObjectExpression') fail(node, `expected an object literal`);
  const entries = node.properties.map((/** @type {any} */ p) => [keyOf(p), p.value]);
  const keys = entries.map(([key]) => key);
  const dup = keys.find((key, i) => keys.indexOf(key) !== i);
  return dup === undefined ? entries : fail(node, `duplicate key ${dup}`);
}

/** String values of a `[…]` literal of plain strings. */
function stringsOf(/** @type {any} */ node) {
  const ok = node?.type === 'ArrayExpression' && node.elements.every(isString);
  return ok
    ? node.elements.map((/** @type {any} */ e) => e.value)
    : fail(node, 'expected [<string>…]');
}
const isString = (/** @type {any} */ node) => node?.type === 'StringLiteral';

/**
 * Literal kinds `t.Enum` may list. Camoufox ships `t.Enum(['mixed', true])`
 * (`axTypes.AXTree.checked`); Juggler matches with `indexOf`, so values keep
 * their JS type and `true` never equals `'true'`.
 */
const ENUM_LITERALS = new Set(['StringLiteral', 'BooleanLiteral']);

/** Values of a `t.Enum([…])` list of string or boolean literals. */
function enumValuesOf(/** @type {any} */ node) {
  const isLiteral = (/** @type {any} */ e) => ENUM_LITERALS.has(e?.type);
  const ok = node?.type === 'ArrayExpression' && node.elements.every(isLiteral);
  return ok
    ? node.elements.map((/** @type {any} */ e) => e.value)
    : fail(node, 'expected [<string|boolean>…]');
}

/** Resolve a named declaration once; a cycle without `t.Recursive` fails. */
function named(/** @type {any} */ ix, /** @type {string} */ name, /** @type {any} */ at) {
  const node = ix.decls.get(name) ?? fail(at, `unknown reference ${name}`);
  if (ix.memo.has(name)) return ix.memo.get(name);
  if (ix.active.has(name)) fail(at, `cyclic reference ${name} without t.Recursive`);
  ix.active.add(name);
  ix.memo.set(name, typeOf(node, ix));
  ix.active.delete(name);
  return ix.memo.get(name);
}

/** `t.<Name>(…)` builders: arity, then the normalized type. */
const CALLS = Object.freeze({
  Array: [
    1,
    (/** @type {any[]} */ [item], /** @type {any} */ ix) => ({
      t: 'Array',
      item: typeOf(item, ix),
    }),
  ],
  Nullable: [
    1,
    (/** @type {any[]} */ [inner], /** @type {any} */ ix) => ({
      t: 'Nullable',
      inner: typeOf(inner, ix),
    }),
  ],
  Enum: [1, (/** @type {any[]} */ [list]) => ({ t: 'Enum', values: enumValuesOf(list) })],
  Recursive: [2, (/** @type {any[]} */ args, /** @type {any} */ ix) => recursiveRef(args, ix)],
});

/** `t.Recursive(X, 'Name')` → a Ref resolved later in its own schema. */
function recursiveRef(/** @type {any[]} */ [ns, name], /** @type {any} */ ix) {
  if (ns.type !== 'Identifier' || !isString(name)) fail(ns, 'expected t.Recursive(X, <string>)');
  const target = `${ns.name}.${name.value}`;
  return ix.decls.has(target)
    ? { t: 'Ref', ns: ns.name, name: name.value }
    : fail(ns, `unknown ${target}`);
}

/** Normalized type of a `t.<Name>(…)` call. */
function callType(/** @type {any} */ node, /** @type {any} */ ix) {
  const rule = own(CALLS, tMember(node.callee) ?? '');
  if (rule === undefined)
    fail(node, 'unsupported call (t.Optional is only allowed as a field value)');
  if (node.arguments.length !== rule[0]) fail(node, `expected ${rule[0]} argument(s)`);
  return rule[1](node.arguments, ix);
}

/** Normalized type of a `t.<Primitive>` or a reference to an assigned `X.Name`. */
function memberType(/** @type {any} */ node, /** @type {any} */ ix) {
  const primitive = tMember(node);
  if (primitive === undefined) return named(ix, memberName(node), node);
  return PRIMITIVES.has(primitive) ? { t: primitive } : fail(node, `unsupported t.${primitive}`);
}

/** Expression kind → normalized-type builder. */
const TYPE_OF = Object.freeze({
  ObjectExpression: (/** @type {any} */ node, /** @type {any} */ ix) => ({
    t: 'Object',
    fields: fieldsOf(node, ix),
  }),
  MemberExpression: memberType,
  Identifier: (/** @type {any} */ node, /** @type {any} */ ix) => named(ix, node.name, node),
  CallExpression: callType,
});

/** Normalized type of any supported expression. */
function typeOf(/** @type {any} */ node, /** @type {any} */ ix) {
  const rule = own(TYPE_OF, node?.type ?? '');
  return rule === undefined ? fail(node, `unsupported expression ${node?.type}`) : rule(node, ix);
}

/** One object field; `t.Optional(<type>)` marks it optional. */
function fieldOf(/** @type {any} */ node, /** @type {any} */ ix) {
  if (node.type !== 'CallExpression' || tMember(node.callee) !== 'Optional')
    return { optional: false, type: typeOf(node, ix) };
  if (node.arguments.length !== 1) fail(node, 'expected 1 argument');
  return { optional: true, type: typeOf(node.arguments[0], ix) };
}

/** Field map of an object literal. */
function fieldsOf(/** @type {any} */ node, /** @type {any} */ ix) {
  const entries = entriesOf(node).map(([key, value]) => [key, fieldOf(value, ix)]);
  return Object.fromEntries(entries);
}

export { entriesOf, fail, isString, memberName, named, own, stringsOf, typeOf };
