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

const BABEL = Object.freeze({ sourceType: 'module' });
const IMPORT = "expected const {t} = ChromeUtils.importESModule('…')";

/** The single `const` declarator of a statement. */
function singleConst(/** @type {any} */ stmt) {
  const ok = stmt?.type === 'VariableDeclaration' && stmt.kind === 'const';
  return ok && stmt.declarations.length === 1 ? stmt.declarations[0] : fail(stmt, 'expected const');
}

/** `{t}` — the only binding the import statement may declare. */
function bindsOnlyT(/** @type {any} */ id) {
  const [prop, ...rest] = id.properties;
  return rest.length === 0 && prop?.shorthand === true && prop.key.name === 't';
}

/** `ChromeUtils.importESModule('<url>')` with exactly one string argument. */
function isImportCall(/** @type {any} */ init) {
  if (init?.type !== 'CallExpression' || init.callee.type !== 'MemberExpression') return false;
  const [arg, ...more] = init.arguments;
  if (!isString(arg) || more.length > 0) return false;
  return memberName(init.callee) === 'ChromeUtils.importESModule';
}

/** Statement 1, import form: `const {t} = ChromeUtils.importESModule('<url>')`. */
function checkImport(/** @type {any} */ id, /** @type {any} */ init) {
  if (!bindsOnlyT(id) || !isImportCall(init)) fail(id, IMPORT);
}

/** Statement 1: index `const X = {…}`; an empty literal opens a type namespace. */
function indexConst(/** @type {any} */ stmt, /** @type {any} */ ix) {
  const { id, init } = singleConst(stmt);
  if (id.type === 'ObjectPattern') return checkImport(id, init);
  if (id.type !== 'Identifier' || init?.type !== 'ObjectExpression')
    fail(stmt, 'expected const X = {…}');
  ix.decls.set(id.name, init);
  if (init.properties.length === 0) ix.namespaces.add(id.name);
}

/** Statement 2: index `X.Name = <type>` into the namespace `X`. */
function indexMember(/** @type {any} */ stmt, /** @type {any} */ ix) {
  const expr = stmt.expression;
  if (expr.type !== 'AssignmentExpression' || expr.operator !== '=')
    fail(stmt, 'expected X.Name = …');
  const name = memberName(expr.left);
  if (!ix.namespaces.has(name.split('.')[0])) fail(expr.left, `${name}: X is not a const X = {}`);
  if (ix.decls.has(name)) fail(expr.left, `duplicate assignment ${name}`);
  ix.decls.set(name, expr.right);
}

/** Statement 3: `export const protocol = {domains: {…}}`. */
function indexRoot(/** @type {any} */ stmt, /** @type {any} */ ix) {
  const { id, init } = singleConst(stmt.declaration ?? stmt);
  if (id.name !== 'protocol' || ix.root !== undefined)
    fail(stmt, 'expected one export const protocol');
  const entries = entriesOf(init);
  if (entries.length !== 1 || entries[0][0] !== 'domains') fail(init, 'expected {domains: {…}}');
  ix.root = entries[0][1];
}

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
    throw new UnparseableSchemaError(error?.loc?.line ?? 0, `syntax error: ${error?.message}`);
  }
}

/** Declaration index of every top-level statement. */
function indexProgram(/** @type {string} */ text) {
  const ix = { decls: new Map(), namespaces: new Set(), memo: new Map(), active: new Set() };
  for (const stmt of parseProgram(text).body) {
    const index = own(STATEMENTS, stmt.type) ?? fail(stmt, `unsupported statement ${stmt.type}`);
    index(stmt, ix);
  }
  return Object.hasOwn(ix, 'root') ? ix : fail(undefined, 'no export const protocol');
}

/** `{key: read(value)}` over an object literal. */
function mapEntries(/** @type {any} */ node, /** @type {(value: any) => unknown} */ read) {
  return Object.fromEntries(entriesOf(node).map(([key, value]) => [key, read(value)]));
}

/** Field map of a type that must resolve to an object. */
function objectFields(/** @type {any} */ node, /** @type {any} */ ix) {
  const type = typeOf(node, ix);
  return type.t === 'Object' ? type.fields : fail(node, 'expected an object type');
}

/** `{params, returns}` of one method; both default to `{}`. */
function methodOf(/** @type {any} */ node, /** @type {any} */ ix) {
  const method = { params: {}, returns: {} };
  for (const [key, value] of entriesOf(node)) {
    if (!Object.hasOwn(method, key)) fail(value, `unsupported method key ${key}`);
    method[key] = objectFields(value, ix);
  }
  return method;
}

/** Domain key → reader; `targets` and `types` are validated, then dropped. */
const DOMAIN_KEYS = Object.freeze({
  targets: (/** @type {any} */ node) => stringsOf(node) && undefined,
  types: (/** @type {any} */ node, /** @type {any} */ ix) => typeOf(node, ix) && undefined,
  events: (/** @type {any} */ node, /** @type {any} */ ix, /** @type {any} */ domain) => {
    domain.events = mapEntries(node, payload => objectFields(payload, ix));
  },
  methods: (/** @type {any} */ node, /** @type {any} */ ix, /** @type {any} */ domain) => {
    domain.methods = mapEntries(node, method => methodOf(method, ix));
  },
});

/** `{methods, events}` of the domain a `protocol.domains` entry names. */
function domainOf(/** @type {any} */ ref, /** @type {any} */ ix) {
  const node =
    ref.type === 'Identifier' ? (ix.decls.get(ref.name) ?? fail(ref, 'unknown domain')) : ref;
  const domain = { methods: {}, events: {} };
  for (const [key, value] of entriesOf(node)) {
    const read = own(DOMAIN_KEYS, key) ?? fail(value, `unsupported domain key ${key}`);
    read(value, ix, domain);
  }
  return domain;
}

/** Every type assigned into namespace `ns`, by name. */
function namespaceOf(/** @type {string} */ ns, /** @type {any} */ ix) {
  const names = [...ix.decls.keys()].filter(name => name.startsWith(`${ns}.`));
  return Object.fromEntries(names.map(name => [name.slice(ns.length + 1), named(ix, name)]));
}

/**
 * Normalized schema of a Juggler `Protocol.js` source.
 *
 * @param {string} text - Source text; parsed, never executed.
 * @returns {import('./juggler-schema.d.mts').NormalizedSchema} Domains and type namespaces.
 * @throws {UnparseableSchemaError} On any construct outside the grammar, with its line.
 */
export function parseJugglerSchema(text) {
  const ix = indexProgram(text);
  const domains = mapEntries(ix.root, ref => domainOf(ref, ix));
  const namespaces = Object.fromEntries([...ix.namespaces].map(ns => [ns, namespaceOf(ns, ix)]));
  return { domains, namespaces };
}
