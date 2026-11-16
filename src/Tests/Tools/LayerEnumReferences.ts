/**
 * Layer enum-reference scanner — TypeScript-AST helpers behind the
 * layer-direction policy test.
 *
 * <p>The policy owns the layer matrix and baseline; this module owns the
 * resolve-the-enum work so the test stays under the file cap. It reports
 * members reached through imports, aliases, destructuring, type queries,
 * indexed types and import types, and skips genuinely shadowed bindings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

import { CompanyTypes } from '../../Definitions.js';

/**
 * Read a statically resolvable string-like literal.
 * @param node - String literal or no-substitution template literal.
 * @returns The literal text, or '' for any other node.
 */
export function literalTextOf(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
}

/** Imported bindings through which a file can reach the `CompanyTypes` enum. */
interface IEnumBindings {
  readonly direct: Set<string>;
  readonly namespaces: Set<string>;
}

/** The enum's member names, used to recognise a property or element access. */
const BANK_MEMBERS: ReadonlySet<string> = new Set(Object.keys(CompanyTypes));

/**
 * Read the local aliases that can reach the `CompanyTypes` enum.
 * @param sourceFile - Parsed source file.
 * @returns Direct and namespace import bindings.
 */
function enumBindings(sourceFile: ts.SourceFile): IEnumBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (ts.isNamedImports(bindings)) collectDirectBindings(bindings, direct);
  }
  return { direct, namespaces };
}

/**
 * Add named imports that resolve to `CompanyTypes`, including aliases.
 * @param bindings - Named import clause.
 * @param direct - Accumulator of local binding names.
 * @returns The same accumulator.
 */
function collectDirectBindings(
  bindings: ts.NamedImports,
  direct: Set<string>,
): ReadonlySet<string> {
  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (imported === 'CompanyTypes') direct.add(element.name.text);
  }
  return direct;
}

/**
 * Whether an expression is the imported enum binding or a namespace path to it.
 * @param expression - Property or element access target.
 * @param bindings - Local import bindings.
 * @returns True when the expression names `CompanyTypes`.
 */
function isEnumBase(expression: ts.Expression, bindings: IEnumBindings): boolean {
  const base = unwrapExpression(expression);
  if (ts.isIdentifier(base)) {
    const isDirect = bindings.direct.has(base.text);
    return isDirect && !isShadowed(base);
  }
  if (ts.isElementAccessExpression(base)) return isEnumElementBase(base, bindings);
  const isNamespaceEnum =
    ts.isPropertyAccessExpression(base) &&
    base.name.text === 'CompanyTypes' &&
    ts.isIdentifier(base.expression);
  const isNamespace = isNamespaceEnum && bindings.namespaces.has(base.expression.text);
  return isNamespace && !isShadowed(base.expression);
}

/**
 * Whether an element access reads the namespace's `CompanyTypes` export.
 * @param node - Element access.
 * @param bindings - Local import bindings.
 * @returns True for a live `defs['CompanyTypes']` base.
 */
function isEnumElementBase(node: ts.ElementAccessExpression, bindings: IEnumBindings): boolean {
  const key = literalTextOf(node.argumentExpression);
  if (key !== 'CompanyTypes' || !ts.isIdentifier(node.expression)) return false;
  return bindings.namespaces.has(node.expression.text) && !isShadowed(node.expression);
}

/**
 * Remove parentheses, assertions and non-null wrappers.
 * @param expression - Candidate expression.
 * @returns The innermost expression.
 */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Whether any enclosing scope binds the identifier to something other than the enum.
 * @param identifier - Identifier being resolved.
 * @returns True when a parameter or local declaration shadows the import.
 */
function isShadowed(identifier: ts.Identifier): boolean {
  return hasEnclosingBinding(identifier, 'value');
}

/**
 * Whether a type-position identifier is shadowed by a type binding.
 * @param identifier - Identifier being resolved.
 * @returns True when a type parameter or type declaration shadows the import.
 */
function isTypeShadowed(identifier: ts.Identifier): boolean {
  return hasEnclosingBinding(identifier, 'type');
}

/**
 * Walk enclosing scopes for a binding in one namespace.
 * @param identifier - Identifier being resolved.
 * @param kind - Value or type namespace.
 * @returns True when an enclosing scope binds the name.
 */
function hasEnclosingBinding(identifier: ts.Identifier, kind: 'value' | 'type'): boolean {
  let scope = identifier.parent;
  for (;;) {
    if (scopeHasBinding(scope, identifier.text, kind)) return true;
    if (ts.isSourceFile(scope)) return false;
    scope = scope.parent;
  }
}

/**
 * Whether a scope directly declares the name.
 * @param scope - Candidate lexical scope.
 * @param name - Identifier text.
 * @param kind - Value or type namespace.
 * @returns True when the scope binds the name.
 */
function scopeHasBinding(scope: ts.Node, name: string, kind: 'value' | 'type'): boolean {
  if (ts.isFunctionLike(scope)) return functionLikeHasBinding(scope, name, kind);
  if (ts.isCatchClause(scope)) return kind === 'value' && catchHasBinding(scope, name);
  if (isTypeDeclaration(scope)) return kind === 'type' && typeParametersHaveName(scope, name);
  if (isForStatement(scope)) return kind === 'value' && forBindingHasName(scope, name);
  return isStatementScope(scope) && statementsHaveName(scope.statements, name, kind);
}

/**
 * Value/type bindings a function-like scope introduces.
 * @param scope - Function-like declaration.
 * @param name - Identifier text.
 * @param kind - Value or type namespace.
 * @returns True when the scope binds the name in that namespace.
 */
function functionLikeHasBinding(
  scope: ts.SignatureDeclaration,
  name: string,
  kind: 'value' | 'type',
): boolean {
  if (parametersHaveName(scope.parameters, name)) return true;
  return kind === 'type' && typeParametersHaveName(scope, name);
}

/**
 * Whether a catch clause binds the name.
 * @param scope - Catch clause.
 * @param name - Identifier text.
 * @returns True when the catch binding uses the name.
 */
function catchHasBinding(scope: ts.CatchClause, name: string): boolean {
  const declaration = scope.variableDeclaration;
  return declaration !== undefined && bindingHasName(declaration.name, name);
}

/**
 * Whether a scope is a block-like statement container.
 * @param scope - Candidate scope.
 * @returns True for a block, source file or module block.
 */
function isStatementScope(scope: ts.Node): scope is ts.Block | ts.SourceFile | ts.ModuleBlock {
  return ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope);
}

/**
 * Whether a node is a for statement.
 * @param node - Candidate node.
 * @returns True for `for`, `for...of` and `for...in`.
 */
function isForStatement(
  node: ts.Node,
): node is ts.ForStatement | ts.ForOfStatement | ts.ForInStatement {
  return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
}

/**
 * Whether a for-loop's declaration binds the name.
 * @param node - For statement.
 * @param name - Identifier text.
 * @returns True when the loop declares the name.
 */
function forBindingHasName(
  node: ts.ForStatement | ts.ForOfStatement | ts.ForInStatement,
  name: string,
): boolean {
  const initializer = node.initializer;
  if (initializer === undefined || !ts.isVariableDeclarationList(initializer)) return false;
  return initializer.declarations.some((declaration): boolean =>
    bindingHasName(declaration.name, name),
  );
}

/**
 * Whether a node declares type parameters.
 * @param node - Candidate declaration.
 * @returns True for a class, interface or type alias.
 */
function isTypeDeclaration(node: ts.Node): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}

/**
 * Whether a declaration's type parameters use the name.
 * @param scope - Candidate declaration.
 * @param name - Identifier text.
 * @returns True when a type parameter binds the name.
 */
function typeParametersHaveName(scope: ts.Node, name: string): boolean {
  const parameters = (scope as { readonly typeParameters?: readonly ts.TypeParameterDeclaration[] })
    .typeParameters;
  return parameters?.some((param): boolean => param.name.text === name) ?? false;
}

/**
 * Whether any parameter binding uses the name.
 * @param parameters - Function parameters.
 * @param name - Identifier text.
 * @returns True when a parameter binds the name.
 */
function parametersHaveName(parameters: readonly ts.ParameterDeclaration[], name: string): boolean {
  return parameters.some((parameter): boolean => bindingHasName(parameter.name, name));
}

/**
 * Whether any direct statement binds the name.
 * @param statements - Statements of one scope.
 * @param name - Identifier text.
 * @param kind - Value or type namespace.
 * @returns True when a statement declares the name.
 */
function statementsHaveName(
  statements: readonly ts.Statement[],
  name: string,
  kind: 'value' | 'type',
): boolean {
  return statements.some((statement): boolean => statementHasName(statement, name, kind));
}

/**
 * Whether one direct statement declares the name.
 * @param statement - Candidate statement.
 * @param name - Identifier text.
 * @param kind - Value or type namespace.
 * @returns True for a matching variable, function, class, enum or import-equals.
 */
function statementHasName(statement: ts.Statement, name: string, kind: 'value' | 'type'): boolean {
  if (ts.isVariableStatement(statement)) {
    return kind === 'value' && variableStatementHasName(statement, name);
  }
  if (ts.isImportEqualsDeclaration(statement))
    return kind === 'value' && statement.name.text === name;
  if (ts.isFunctionDeclaration(statement)) return kind === 'value' && statement.name?.text === name;
  if (isClassOrEnum(statement)) return statement.name?.text === name;
  return typeDeclarationHasName(statement, name, kind);
}

/**
 * Whether a statement declares a class or enum.
 * @param statement - Candidate statement.
 * @returns True for a class or enum declaration.
 */
function isClassOrEnum(
  statement: ts.Statement,
): statement is ts.ClassDeclaration | ts.EnumDeclaration {
  return ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement);
}

/**
 * Whether a variable statement binds the name.
 * @param statement - Variable statement.
 * @param name - Identifier text.
 * @returns True when a declaration binds the name.
 */
function variableStatementHasName(statement: ts.VariableStatement, name: string): boolean {
  return statement.declarationList.declarations.some((declaration): boolean =>
    bindingHasName(declaration.name, name),
  );
}

/**
 * Whether a type-only declaration binds the name.
 * @param statement - Candidate statement.
 * @param name - Identifier text.
 * @param kind - Value or type namespace.
 * @returns True for a matching type alias or interface in a type context.
 */
function typeDeclarationHasName(
  statement: ts.Statement,
  name: string,
  kind: 'value' | 'type',
): boolean {
  const isTypeOnly = ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement);
  return kind === 'type' && isTypeOnly && statement.name.text === name;
}

/**
 * Whether a binding pattern contains the name.
 * @param binding - Identifier or destructuring pattern.
 * @param name - Identifier text.
 * @returns True when the binding declares the name.
 */
function bindingHasName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element): boolean => !ts.isOmittedExpression(element) && bindingHasName(element.name, name),
  );
}

/**
 * Add every member named by an object-destructuring binding.
 * @param pattern - Object binding pattern.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectBindingMembers(
  pattern: ts.ObjectBindingPattern,
  members: Set<string>,
): ReadonlySet<string> {
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) {
      members.add('dynamic:rest');
      continue;
    }
    const member = bindingNameOf(element.propertyName ?? element.name);
    if (BANK_MEMBERS.has(member)) members.add(member);
    if (member === '') members.add(`dynamic:${element.getText()}`);
  }
  return members;
}

/**
 * Read a statically known property name from a binding key.
 * @param node - Identifier, string literal or computed literal.
 * @returns The property text, or '' when it is not statically known.
 */
function bindingNameOf(node: ts.Node): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return literalTextOf(node.expression);
  return '';
}

/**
 * Whether a qualified type name starts at the enum binding.
 * @param left - Left side of the qualified name.
 * @param bindings - Local import bindings.
 * @returns True for `CompanyTypes` or a namespace path to it.
 */
function isEnumQualifiedLeft(left: ts.EntityName, bindings: IEnumBindings): boolean {
  if (ts.isIdentifier(left)) return bindings.direct.has(left.text);
  const isNamespaceEnum =
    ts.isQualifiedName(left) && left.right.text === 'CompanyTypes' && ts.isIdentifier(left.left);
  return isNamespaceEnum && bindings.namespaces.has(left.left.text);
}

/**
 * Collect a property or element access rooted at the enum binding.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectAccessMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (ts.isPropertyAccessExpression(node)) {
    const member = node.name.text;
    if (BANK_MEMBERS.has(member) && isEnumBase(node.expression, bindings)) members.add(member);
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    const member = literalTextOf(argument);
    if (BANK_MEMBERS.has(member) && isEnumBase(node.expression, bindings)) members.add(member);
    if (member === '' && isEnumBase(node.expression, bindings)) {
      members.add(`dynamic:${argument.getText()}`);
    }
  }
  return members;
}

/**
 * Collect an object-destructuring binding of the enum.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectDestructuredMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  const isEnumDestructure =
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    isEnumBase(node.initializer, bindings);
  if (isEnumDestructure) collectBindingMembers(node.name, members);
  return members;
}

/**
 * Collect a qualified type name rooted at the enum binding.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectQualifiedMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  const isEnumType =
    ts.isQualifiedName(node) &&
    BANK_MEMBERS.has(node.right.text) &&
    isEnumQualifiedLeft(node.left, bindings);
  const isImportTypeEnum =
    ts.isQualifiedName(node) &&
    BANK_MEMBERS.has(node.right.text) &&
    isImportTypeEnumQualifier(node);
  if (isEnumType || isImportTypeEnum) members.add(node.right.text);
  return members;
}

/**
 * Whether a qualified name is the member qualifier of an import type.
 * @param node - Qualified name to test.
 * @returns True for `import('.../Definitions.js').CompanyTypes.Member`.
 */
function isImportTypeEnumQualifier(node: ts.QualifiedName): boolean {
  const parent = node.parent;
  if (!ts.isImportTypeNode(parent) || parent.qualifier !== node) return false;
  if (!ts.isIdentifier(node.left) || node.left.text !== 'CompanyTypes') return false;
  return true;
}

/**
 * Flag an alias that can carry the enum into a neutral layer.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator, prefixed with `alias:` for an alias binding.
 * @returns The same accumulator.
 */
function collectAliasMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (isEnumBase(node.right, bindings)) members.add(`alias:${node.left.getText()}`);
    return members;
  }
  if (!ts.isVariableDeclaration(node)) return members;
  if (ts.isIdentifier(node.name) && node.initializer !== undefined) {
    if (isEnumBase(node.initializer, bindings)) members.add(`alias:${node.name.text}`);
  }
  collectNamespaceAlias(node, bindings, members);
  return members;
}

/**
 * Flag a namespace destructuring such as `const { CompanyTypes: banks } = defs`.
 * @param node - Variable declaration.
 * @param bindings - Local import bindings.
 * @param members - Accumulator.
 * @returns The same accumulator.
 */
function collectNamespaceAlias(
  node: ts.VariableDeclaration,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (!isNamespaceDestructure(node, bindings)) return members;
  for (const element of (node.name as ts.ObjectBindingPattern).elements) {
    collectNamespaceElement(element, members);
  }
  return members;
}

/**
 * Record one namespace binding: an alias, or members from a nested pattern.
 * @param element - Object binding element.
 * @param members - Accumulator.
 * @returns The same accumulator.
 */
function collectNamespaceElement(
  element: ts.BindingElement,
  members: Set<string>,
): ReadonlySet<string> {
  const property = bindingNameOf(element.propertyName ?? element.name);
  if (property !== 'CompanyTypes') return members;
  if (ts.isIdentifier(element.name)) members.add(`alias:${element.name.text}`);
  if (ts.isObjectBindingPattern(element.name)) collectBindingMembers(element.name, members);
  return members;
}
/**
 * Whether a declaration destructures an imported namespace.
 * @param node - Variable declaration.
 * @param bindings - Local import bindings.
 * @returns True for `const ... = namespaceImport`.
 */
function isNamespaceDestructure(node: ts.VariableDeclaration, bindings: IEnumBindings): boolean {
  if (!ts.isObjectBindingPattern(node.name) || node.initializer === undefined) return false;
  if (!ts.isIdentifier(node.initializer)) return false;
  return bindings.namespaces.has(node.initializer.text) && !isShadowed(node.initializer);
}
/**
 * Collect an indexed enum type such as `typeof CompanyTypes['Leumi']`.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator.
 * @returns The same accumulator.
 */
function collectIndexedMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (!ts.isIndexedAccessTypeNode(node)) return members;
  const member = ts.isLiteralTypeNode(node.indexType) ? literalTextOf(node.indexType.literal) : '';
  if (BANK_MEMBERS.has(member) && isEnumTypeObject(node.objectType, bindings)) members.add(member);
  if (member === '' && isEnumTypeObject(node.objectType, bindings)) {
    members.add(`dynamic:${node.indexType.getText()}`);
  }
  return members;
}

/**
 * Whether an indexed-access object names the enum type.
 * @param node - Indexed object type.
 * @param bindings - Local import bindings.
 * @returns True for `typeof CompanyTypes` or `CompanyTypes`.
 */
function isEnumTypeObject(node: ts.TypeNode, bindings: IEnumBindings): boolean {
  if (ts.isImportTypeNode(node)) return isEnumImportType(node);
  if (ts.isTypeQueryNode(node)) return isEnumTypeName(node.exprName, bindings, 'value');
  return ts.isTypeReferenceNode(node) && isEnumTypeName(node.typeName, bindings, 'type');
}

/**
 * Whether an import type resolves to the enum.
 * @param node - Import type node.
 * @returns True for `import('.../Definitions.js').CompanyTypes`.
 */
function isEnumImportType(node: ts.ImportTypeNode): boolean {
  const qualifier = node.qualifier;
  if (qualifier === undefined || !ts.isIdentifier(qualifier) || qualifier.text !== 'CompanyTypes') {
    return false;
  }
  return true;
}

/**
 * Whether an entity name resolves to the enum or a namespace path to it.
 * @param name - Type entity name.
 * @param bindings - Local import bindings.
 * @param kind - Value or type namespace.
 * @returns True for `CompanyTypes` or `defs.CompanyTypes`.
 */
function isEnumTypeName(
  name: ts.EntityName,
  bindings: IEnumBindings,
  kind: 'value' | 'type',
): boolean {
  const isShadowing = kind === 'value' ? isShadowed : isTypeShadowed;
  if (ts.isIdentifier(name)) return bindings.direct.has(name.text) && !isShadowing(name);
  const isNamespaceEnum = name.right.text === 'CompanyTypes' && ts.isIdentifier(name.left);
  return isNamespaceEnum && bindings.namespaces.has(name.left.text) && !isShadowing(name.left);
}

/**
 * Collect bank-member accesses from one syntax subtree.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns True once the subtree is visited.
 */
function collectEnumMembers(node: ts.Node, bindings: IEnumBindings, members: Set<string>): true {
  collectAccessMember(node, bindings, members);
  collectDestructuredMember(node, bindings, members);
  collectQualifiedMember(node, bindings, members);
  collectAliasMember(node, bindings, members);
  collectIndexedMember(node, bindings, members);
  ts.forEachChild(node, (child): false => {
    collectEnumMembers(child, bindings, members);
    return false;
  });
  return true;
}

/**
 * List neutral-layer references to a concrete `CompanyTypes` member.
 * @param files - Production files to scan.
 * @param neutralLayers - Layers that must stay bank-agnostic.
 * @param pipelineRoot - Absolute Pipeline root for relative keys.
 * @returns `relative/path.ts -> Member` entries, sorted.
 */
export function collectCompanyTypeReferences(
  files: readonly string[],
  neutralLayers: readonly string[],
  pipelineRoot: string,
): readonly string[] {
  const hits: string[] = [];
  for (const file of files) {
    const relative = path.relative(pipelineRoot, file).split(path.sep).join('/');
    const layer = relative.split('/')[0];
    if (!neutralLayers.includes(layer)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = enumBindings(sourceFile);
    const hasMembers = new Set<string>();
    collectEnumMembers(sourceFile, bindings, hasMembers);
    for (const member of hasMembers) hits.push(`${relative} -> ${member}`);
  }
  return hits.sort();
}

/**
 * Collect enum members referenced by one synthetic source string.
 * @param source - TypeScript source.
 * @returns Sorted member names, with aliases prefixed `alias:`.
 */
export function enumMembersOf(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const bindings = enumBindings(sourceFile);
  const members = new Set<string>();
  collectEnumMembers(sourceFile, bindings, members);
  return [...members].sort();
}

/**
 * Read every static, re-exported and dynamic import specifier from one file.
 * @param file - Absolute production file path.
 * @returns Specifiers in source order.
 */
export function importSpecifiers(file: string): readonly string[] {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  collectSpecifiers(sourceFile, specs);
  return specs;
}

/**
 * Collect module specifiers from one syntax subtree.
 * @param node - Current node.
 * @param specs - Accumulator, mutated in place.
 * @returns True once the subtree is visited.
 */
function collectSpecifiers(node: ts.Node, specs: string[]): true {
  const specifier = specifierOf(node);
  if (specifier !== '') specs.push(specifier);
  ts.forEachChild(node, (child): false => {
    collectSpecifiers(child, specs);
    return false;
  });
  return true;
}

/**
 * Read the module specifier a node carries, when it is an import form.
 * @param node - Candidate syntax node.
 * @returns Specifier text, or '' for other nodes.
 */
function specifierOf(node: ts.Node): string {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    return specifier === undefined ? '' : stringTextOf(specifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return stringTextOf(node.moduleReference.expression);
  }
  if (ts.isImportTypeNode(node)) {
    const argument = node.argument;
    return ts.isLiteralTypeNode(argument) ? literalTextOf(argument.literal) : '';
  }
  return callSpecifierOf(node);
}

/**
 * Read a dynamic import or createRequire call specifier.
 * @param node - Candidate node.
 * @returns A literal path, `<dynamic>` or `<require>`.
 */
function callSpecifierOf(node: ts.Node): string {
  if (!ts.isCallExpression(node)) return '';
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return importArgumentText(node);
  return isRequireLoader(node) ? '<require>' : '';
}

/**
 * Whether a call is a createRequire helper or a call through one.
 * @param node - Call expression.
 * @returns True for `createRequire(...)` and its returned loader call.
 */
function isRequireLoader(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'createRequire') return true;
  const callee = node.expression;
  return (
    ts.isCallExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'createRequire'
  );
}

/**
 * Read a string-literal node's text.
 * @param node - Candidate node.
 * @returns The literal text, or '' for a missing/non-literal node.
 */
function stringTextOf(node: ts.Node): string {
  return ts.isStringLiteral(node) ? node.text : '';
}

/**
 * Read the literal argument of a dynamic import call.
 * @param node - Call expression.
 * @returns The first argument's text, or '' when it is not a string literal.
 */
function importArgumentText(node: ts.CallExpression): string {
  const argument = node.arguments[0];
  const text = literalTextOf(argument);
  return text === '' ? '<dynamic>' : text;
}

/**
 * Collect import specifiers from one source string.
 * @param source - TypeScript source.
 * @returns Specifiers in source order.
 */
export function specifiersOf(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  collectSpecifiers(sourceFile, specs);
  return specs;
}
