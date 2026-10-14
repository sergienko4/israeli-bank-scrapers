/**
 * Parse a Juggler `Protocol.js` into a normalized schema without ever
 * executing it.
 *
 * The text comes from upstream tags (Playwright and Camoufox), so it is read
 * as an AST only (`@babel/parser` `parse`: no config, file or source-map
 * access). Every verified file uses only
 * three top-level statement kinds:
 *
 * 1. `const {t} = ChromeUtils.importESModule('…')` (checked, then ignored) or
 *    `const X = {…}`;
 * 2. `X.Name = <type>`, where X is a top-level `const X = {}` (a type namespace);
 * 3. `export const protocol = {domains: {Name, …}}`.
 *
 * Types follow `juggler-types.mjs`. Anything else throws
 * {@link UnparseableSchemaError} with its line.
 *
 * Output: `{ domains, namespaces }` — `domains[D] = { methods, events }` with
 * `methods[M] = { params, returns }` (field maps, `{}` when absent) and
 * `namespaces[X][Name]` holding every assigned type, so a `t.Recursive` Ref
 * resolves in the schema it came from.
 */
import { parse } from '@babel/parser';

import {
  entriesOf,
  fail,
  isString,
  memberName,
  named,
  own,
  stringsOf,
  typeOf,
  UnparseableSchemaError,
} from './juggler-types.mjs';

export { UnparseableSchemaError };

/**
 * @typedef {import('@babel/types').ExportNamedDeclaration} ExportNamedDeclaration
 * @typedef {import('@babel/types').ExpressionStatement} ExpressionStatement
 * @typedef {import('@babel/types').Identifier} Identifier
 * @typedef {import('@babel/types').ObjectPattern} ObjectPattern
 * @typedef {import('@babel/types').Statement} Statement
 * @typedef {import('@babel/types').VariableDeclaration} VariableDeclaration
 * @typedef {import('./juggler-types.mjs').MaybeNode} MaybeNode
 * @typedef {import('./juggler-types.mjs').PropValue} PropValue
 * @typedef {import('./juggler-types.mjs').SchemaIndex} SchemaIndex
 * @typedef {import('./juggler-schema.d.mts').IMethod} IMethod
 * @typedef {import('./juggler-schema.d.mts').NormalizedSchema} NormalizedSchema
 * @typedef {import('./juggler-schema.d.mts').SchemaType} SchemaType
 * @typedef {Partial<import('@babel/parser').ParseError> | undefined} BabelFailure - What a
 *   failed `parse` may throw.
 */

const BABEL = Object.freeze({ sourceType: 'module' });
const IMPORT = "expected const {t} = ChromeUtils.importESModule('…')";

/** The single `const` declarator of a statement. */
function singleConst(/** @type {MaybeNode} */ stmt) {
  const ok = stmt?.type === 'VariableDeclaration' && stmt.kind === 'const';
  return ok && stmt.declarations.length === 1 ? stmt.declarations[0] : fail(stmt, 'expected const');
}

/**
 * An object-pattern member as `{t}` reads it: a RestElement has no `shorthand`,
 * and a shorthand member's key is an Identifier.
 *
 * @typedef {{ readonly shorthand: true, readonly key: Identifier }} ShorthandMember
 * @typedef {ShorthandMember | { readonly shorthand?: false }} BindingMember
 */

/** `{t}` — the only binding the import statement may declare. */
function bindsOnlyT(/** @type {ObjectPattern} */ id) {
  const [prop, ...rest] = /** @type {BindingMember[]} */ (id.properties);
  return rest.length === 0 && prop?.shorthand === true && prop.key.name === 't';
}

/** `ChromeUtils.importESModule('<url>')` with exactly one string argument. */
function isImportCall(/** @type {MaybeNode} */ init) {
  if (init?.type !== 'CallExpression' || init.callee.type !== 'MemberExpression') return false;
  const [arg, ...more] = init.arguments;
  if (!isString(arg) || more.length > 0) return false;
  return memberName(init.callee) === 'ChromeUtils.importESModule';
}

/** Statement 1, import form: `const {t} = ChromeUtils.importESModule('<url>')`. */
function checkImport(/** @type {ObjectPattern} */ id, /** @type {MaybeNode} */ init) {
  if (!bindsOnlyT(id) || !isImportCall(init)) fail(id, IMPORT);
}

/** Statement 1: index `const X = {…}`; an empty literal opens a type namespace. */
function indexConst(/** @type {VariableDeclaration} */ stmt, /** @type {SchemaIndex} */ ix) {
  const { id, init } = singleConst(stmt);
  if (id.type === 'ObjectPattern') return checkImport(id, init);
  if (id.type !== 'Identifier' || init?.type !== 'ObjectExpression')
    fail(stmt, 'expected const X = {…}');
  ix.decls.set(id.name, init);
  if (init.properties.length === 0) ix.namespaces.add(id.name);
}

/** Statement 2: index `X.Name = <type>` into the namespace `X`. */
function indexMember(/** @type {ExpressionStatement} */ stmt, /** @type {SchemaIndex} */ ix) {
  const expr = stmt.expression;
  if (expr.type !== 'AssignmentExpression' || expr.operator !== '=')
    fail(stmt, 'expected X.Name = …');
  const name = memberName(expr.left);
  if (!ix.namespaces.has(name.split('.')[0])) fail(expr.left, `${name}: X is not a const X = {}`);
  if (ix.decls.has(name)) fail(expr.left, `duplicate assignment ${name}`);
  ix.decls.set(name, expr.right);
}

/** Statement 3: `export const protocol = {domains: {…}}`. */
function indexRoot(/** @type {ExportNamedDeclaration} */ stmt, /** @type {SchemaIndex} */ ix) {
  const { id, init } = singleConst(stmt.declaration ?? stmt);
  if (/** @type {Partial<Identifier>} */ (id).name !== 'protocol' || ix.root !== undefined)
    fail(stmt, 'expected one export const protocol');
  const entries = entriesOf(init);
  if (entries.length !== 1 || entries[0][0] !== 'domains') fail(init, 'expected {domains: {…}}');
  ix.root = entries[0][1];
}

/** @typedef {(stmt: Statement, ix: SchemaIndex) => void} StatementRule */

/** Statement kind → indexer (rules 1–3 above). */
const STATEMENTS = Object.freeze({
  VariableDeclaration: indexConst,
  ExpressionStatement: indexMember,
  ExportNamedDeclaration: indexRoot,
});

/** Babel program of the source; a syntax error becomes an UnparseableSchemaError. */
function parseProgram(/** @type {string} */ text) {
  try {
    return parse(text, BABEL).program;
  } catch (error) {
    throw new UnparseableSchemaError(
      /** @type {BabelFailure} */ (error)?.loc?.line ?? 0,
      `syntax error: ${/** @type {BabelFailure} */ (error)?.message}`,
    );
  }
}

/** Declaration index of every top-level statement. */
function indexProgram(/** @type {string} */ text) {
  /** @type {SchemaIndex} */
  const ix = { decls: new Map(), namespaces: new Set(), memo: new Map(), active: new Set() };
  for (const stmt of parseProgram(text).body) {
    const index = own(STATEMENTS, stmt.type) ?? fail(stmt, `unsupported statement ${stmt.type}`);
    /** @type {StatementRule} */ (index)(stmt, ix);
  }
  return Object.hasOwn(ix, 'root') ? ix : fail(undefined, 'no export const protocol');
}

/**
 * `{key: read(value)}` over an object literal.
 *
 * @template T
 * @param {MaybeNode} node - The object literal.
 * @param {(value: PropValue) => T} read - Reader of one property value.
 * @returns {Readonly<Record<string, T>>} Every key, with its read value.
 */
function mapEntries(node, read) {
  return Object.fromEntries(entriesOf(node).map(([key, value]) => [key, read(value)]));
}

/** Field map of a type that must resolve to an object. */
function objectFields(/** @type {PropValue} */ node, /** @type {SchemaIndex} */ ix) {
  const type = typeOf(node, ix);
  return type.t === 'Object' ? type.fields : fail(node, 'expected an object type');
}

/**
 * An IMethod being read.
 *
 * @typedef {{ params: IMethod['params'], returns: IMethod['returns'] }} MethodDraft
 */

/** `{params, returns}` of one method; both default to `{}`. */
function methodOf(/** @type {PropValue} */ node, /** @type {SchemaIndex} */ ix) {
  /** @type {MethodDraft} */
  const method = { params: {}, returns: {} };
  for (const [key, value] of entriesOf(node)) {
    if (!Object.hasOwn(method, key)) fail(value, `unsupported method key ${key}`);
    method[/** @type {keyof MethodDraft} */ (key)] = objectFields(value, ix);
  }
  return method;
}

/**
 * An IDomain being read, and the reader of one of its keys.
 *
 * @typedef {{ methods: IDomain['methods'], events: IDomain['events'] }} DomainDraft
 * @typedef {(node: PropValue, ix: SchemaIndex, domain: DomainDraft) => void} DomainRule
 * @typedef {import('./juggler-schema.d.mts').IDomain} IDomain
 */

/** Domain key → reader; `targets` and `types` are validated, then dropped. */
const DOMAIN_KEYS = Object.freeze(
  /** @satisfies {Record<string, DomainRule>} */ ({
    targets: node => stringsOf(node) && undefined,
    types: (node, ix) => typeOf(node, ix) && undefined,
    events: (node, ix, domain) => {
      domain.events = mapEntries(node, payload => objectFields(payload, ix));
    },
    methods: (node, ix, domain) => {
      domain.methods = mapEntries(node, method => methodOf(method, ix));
    },
  }),
);

/** `{methods, events}` of the domain a `protocol.domains` entry names. */
function domainOf(/** @type {PropValue} */ ref, /** @type {SchemaIndex} */ ix) {
  const node =
    ref.type === 'Identifier' ? (ix.decls.get(ref.name) ?? fail(ref, 'unknown domain')) : ref;
  /** @type {DomainDraft} */
  const domain = { methods: {}, events: {} };
  for (const [key, value] of entriesOf(node)) {
    const read = own(DOMAIN_KEYS, key) ?? fail(value, `unsupported domain key ${key}`);
    read(value, ix, domain);
  }
  return domain;
}

/** @returns {Readonly<Record<string, SchemaType>>} Every type assigned into `ns`, by name. */
function namespaceOf(/** @type {string} */ ns, /** @type {SchemaIndex} */ ix) {
  const names = [...ix.decls.keys()].filter(name => name.startsWith(`${ns}.`));
  return Object.fromEntries(names.map(name => [name.slice(ns.length + 1), named(ix, name)]));
}

/**
 * Normalized schema of a Juggler `Protocol.js` source.
 *
 * @param {string} text - Source text; parsed, never executed.
 * @returns {NormalizedSchema} Domains and type namespaces.
 * @throws {UnparseableSchemaError} On any construct outside the grammar, with its line.
 */
export function parseJugglerSchema(text) {
  const ix = indexProgram(text);
  const domains = mapEntries(ix.root, ref => domainOf(ref, ix));
  /** @type {NormalizedSchema['namespaces']} */
  const namespaces = Object.fromEntries([...ix.namespaces].map(ns => [ns, namespaceOf(ns, ix)]));
  return { domains, namespaces };
}
