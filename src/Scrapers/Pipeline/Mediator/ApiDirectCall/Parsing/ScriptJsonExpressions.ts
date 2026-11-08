/**
 * Collects literal strings from supported top-level JavaScript syntax.
 */

import { parse } from '@babel/parser';

/**
 * Visits a named child node.
 * @param node - Parsed syntax node.
 * @param name - Child property.
 * @returns Strings from the supported child syntax.
 */
function child(node: object, name: string): readonly string[] {
  const value: unknown = Reflect.get(node, name);
  return literalsOf(value);
}

/**
 * Visits a named array of child nodes.
 * @param node - Parsed syntax node.
 * @param name - Child list property.
 * @returns Strings from the supported child syntax.
 */
function children(node: object, name: string): readonly string[] {
  const value: unknown = Reflect.get(node, name);
  return Array.isArray(value) ? value.flatMap((item: unknown) => literalsOf(item)) : [];
}

/**
 * Reads a literal string value.
 * @param node - Parsed string literal.
 * @returns Its text.
 */
function literal(node: object): readonly string[] {
  const value: unknown = Reflect.get(node, 'value');
  return typeof value === 'string' ? [value] : [];
}

const CHILD_FIELDS: Readonly<Record<string, string>> = {
  ExpressionStatement: 'expression',
  VariableDeclarator: 'init',
  AssignmentExpression: 'right',
  ObjectProperty: 'value',
};

const CHILD_LISTS: Readonly<Record<string, string>> = {
  VariableDeclaration: 'declarations',
  ObjectExpression: 'properties',
  ArrayExpression: 'elements',
};

/**
 * Recognizes one named identifier in parsed syntax.
 * @param node - Parsed syntax value.
 * @param name - Required identifier.
 * @returns Whether the node is that identifier.
 */
function isIdentifier(node: unknown, name: string): boolean {
  if (typeof node !== 'object' || node === null) return false;
  return Reflect.get(node, 'type') === 'Identifier' && Reflect.get(node, 'name') === name;
}

/**
 * Refuses calls with a reviver or unexpected extra arguments.
 * @param node - Parsed call expression.
 * @returns Whether exactly one argument is present.
 */
function hasOneArgument(node: object): boolean {
  const args: unknown = Reflect.get(node, 'arguments');
  return Array.isArray(args) && args.length === 1;
}

/**
 * Restricts call traversal to an ordinary JSON.parse expression.
 * @param node - Parsed call expression.
 * @returns Whether it invokes the built-in parser by name.
 */
function isJsonParse(node: object): boolean {
  if (!hasOneArgument(node)) return false;
  const callee: unknown = Reflect.get(node, 'callee');
  if (typeof callee !== 'object' || callee === null) return false;
  if (Reflect.get(callee, 'type') !== 'MemberExpression') return false;
  if (Reflect.get(callee, 'computed') !== false) return false;
  const object: unknown = Reflect.get(callee, 'object');
  const property: unknown = Reflect.get(callee, 'property');
  return isIdentifier(object, 'JSON') && isIdentifier(property, 'parse');
}

/**
 * Visits only supported expression and statement forms.
 * @param node - Parsed syntax node or an unsupported value.
 * @returns Its active literal strings.
 */
function literalsOf(node: unknown): readonly string[] {
  if (typeof node !== 'object' || node === null) return [];
  const type: unknown = Reflect.get(node, 'type');
  if (typeof type !== 'string') return [];
  if (type === 'StringLiteral') return literal(node);
  if (type === 'CallExpression' && isJsonParse(node)) return children(node, 'arguments');
  if (Object.hasOwn(CHILD_FIELDS, type)) return child(node, CHILD_FIELDS[type]);
  if (Object.hasOwn(CHILD_LISTS, type)) return children(node, CHILD_LISTS[type]);
  return [];
}

/**
 * Ignores top-level calls whose results are discarded.
 * @param node - Parsed top-level statement.
 * @returns Literal strings from a supported assignment or declaration.
 */
function statementLiterals(node: object): readonly string[] {
  if (Reflect.get(node, 'type') !== 'ExpressionStatement') return literalsOf(node);
  const expression: unknown = Reflect.get(node, 'expression');
  if (typeof expression !== 'object' || expression === null) return [];
  return Reflect.get(expression, 'type') === 'AssignmentExpression' ? literalsOf(expression) : [];
}

/**
 * Reads literal strings from supported top-level script statements.
 * @param text - Unevaluated JavaScript source.
 * @returns Literal strings, throwing on malformed syntax.
 */
function scriptJsonLiterals(text: string): readonly string[] {
  const statements = parse(text, { sourceType: 'unambiguous' }).program.body;
  return statements.flatMap(statementLiterals);
}

export default scriptJsonLiterals;
export { scriptJsonLiterals };
