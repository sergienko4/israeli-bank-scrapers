/**
 * ContextCreationGuard — where code creates a browser context whose options
 * do not come from a context builder.
 *
 * <p>Both builders keep the viewport null, which is what makes the accepted
 * viewport deltas harmless. A context is safe only when its options reach
 * `newContext` exactly as a builder returned them, and a page only when it
 * opens on such a context. Names are resolved by the checker, not by their
 * spelling: a local function named like the builder is not the builder, and
 * a browser held in a variable named `context` is still a browser.
 */

import { join, relative } from 'node:path';

import * as ts from 'typescript';

import { isSameBinding } from './TsProgram.js';

/** Names that create a context; a file naming none of them needs no check. */
const CONTEXT_NAME_RE = /newContext|newPage|launchPersistentContext/u;
const CONTEXT_BUILDER = 'buildContextOptions';
/** The modules whose `buildContextOptions` keeps the viewport null. */
const BUILDER_MODULES: readonly string[] = [
  'src/Common/Browser.ts',
  'src/Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.ts',
];
const CONTEXT_TYPE = 'BrowserContext';
const CONTEXT_TYPE_HOME = '/node_modules/playwright-core/';

/** A program to check, and the repo root its builder modules sit under. */
interface IContextProgram {
  readonly program: ts.Program;
  readonly root: string;
}

/** One file under check. */
interface IContextSite {
  readonly tree: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly builders: readonly string[];
}

/** Whether one mention of a context-creating name is safe. */
type MentionRule = (mention: ts.Node, site: IContextSite) => boolean;

/**
 * A node and every code node under it; JSDoc is not code.
 *
 * @param node - Where to start.
 * @param tree - The tree the node belongs to.
 * @returns The nodes, outermost first.
 */
function codeNodes(node: ts.Node, tree: ts.SourceFile): ts.Node[] {
  const children = node.getChildren(tree).filter(child => !ts.isJSDoc(child));
  const nested = children.flatMap((child: ts.Node): ts.Node[] => codeNodes(child, tree));
  return [node, ...nested];
}

/**
 * Whether a node sits in a type, where a name is not a call.
 *
 * @param node - A syntax node.
 * @returns True under a type node.
 */
function isInType(node: ts.Node): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  return ts.isTypeNode(parent) || isInType(parent);
}

/**
 * The name a code node spells: an identifier or a string key.
 *
 * @param node - A syntax node.
 * @returns The name, or '' for any other node and for names in types.
 */
function mentionName(node: ts.Node): string {
  const isName = ts.isIdentifier(node) || ts.isStringLiteralLike(node);
  return isName && !isInType(node) ? node.text : '';
}

/**
 * The call that invokes a mention as a member: `x.name(…)` or `x['name'](…)`.
 *
 * @param mention - A name node.
 * @returns That call, or none when the name is used any other way.
 */
function calleeOf(mention: ts.Node): ts.CallExpression[] {
  const access = mention.parent;
  const isProperty = ts.isPropertyAccessExpression(access) && access.name === mention;
  const isElement = ts.isElementAccessExpression(access) && access.argumentExpression === mention;
  const call = access.parent;
  const isCall = ts.isCallExpression(call) && call.expression === access;
  return (isProperty || isElement) && isCall ? [call] : [];
}

/**
 * The receiver of a member call: `context` for `context.newPage()`.
 *
 * @param call - A member call.
 * @returns The receiver expression.
 */
function receiverOf(call: ts.CallExpression): ts.Expression {
  const callee = call.expression;
  const isMember = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee);
  return isMember ? callee.expression : callee;
}

/**
 * The file a symbol is declared in.
 *
 * @param symbol - A symbol.
 * @returns The file name with `/` separators, or '' when it has no declaration.
 */
function homeOf(symbol: ts.Symbol): string {
  const declaration = symbol.declarations?.[0];
  return declaration?.getSourceFile().fileName.replaceAll('\\', '/') ?? '';
}

/**
 * What a name finally refers to, through an import.
 *
 * @param checker - The checker.
 * @param name - A name node.
 * @returns The declared symbol, or none when the name does not resolve.
 */
function targetsOf(checker: ts.TypeChecker, name: ts.Node): ts.Symbol[] {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol === undefined) return [];
  const isImported = symbol.declarations?.some(ts.isImportSpecifier) === true;
  return isImported ? [checker.getAliasedSymbol(symbol)] : [symbol];
}

/**
 * Whether a callee is one of the builders, wherever it was imported from.
 *
 * @param callee - A call's callee.
 * @param site - The file under check.
 * @returns True for a name the checker resolves to a builder module's builder.
 */
function isBuilder(callee: ts.Expression, site: IContextSite): boolean {
  if (!ts.isIdentifier(callee)) return false;
  return targetsOf(site.checker, callee).some(target => {
    const home = homeOf(target);
    return target.name === CONTEXT_BUILDER && site.builders.includes(home);
  });
}

/**
 * Whether a variable statement is exported, so another module could alter it.
 *
 * @param declaration - A variable declaration.
 * @returns True under `export const`.
 */
function isExported(declaration: ts.VariableDeclaration): boolean {
  const statement = declaration.parent.parent;
  if (!ts.isVariableStatement(statement)) return false;
  const modifiers = statement.modifiers ?? [];
  return modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Whether a name declares an unexported `const` set straight from a builder.
 *
 * @param name - A name node.
 * @param site - The file under check.
 * @returns True for `const <name> = buildContextOptions(…)`.
 */
function isBuiltConst(name: ts.Node, site: IContextSite): boolean {
  const declaration = name.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.name !== name) return false;
  const value = declaration.initializer;
  if (!value || !ts.isCallExpression(value)) return false;
  const isConst = declaration.parent.getFirstToken()?.kind === ts.SyntaxKind.ConstKeyword;
  return isConst && !isExported(declaration) && isBuilder(value.expression, site);
}

/**
 * The nearest function or file around a node: where its name must be declared.
 *
 * @param node - A syntax node.
 * @returns The scope node.
 */
function scopeOf(node: ts.Node): ts.Node {
  const parent = node.parent;
  return ts.isFunctionLike(parent) || ts.isSourceFile(parent) ? parent : scopeOf(parent);
}

/**
 * Whether an argument is the builder `const` of its scope, and nothing else
 * spells its name there. Two mentions, the declaration and this argument,
 * rule out a later write, a `delete` and an alias; the checker rules out a
 * same-named binding the argument does not refer to.
 *
 * @param arg - The `newContext` argument.
 * @param site - The file under check.
 * @returns True when the options reach `newContext` as built.
 */
function isUntouchedBuild(arg: ts.Identifier, site: IContextSite): boolean {
  const scope = scopeOf(arg);
  const uses = codeNodes(scope, site.tree).filter(node => mentionName(node) === arg.text);
  const built = uses.filter(use => isBuiltConst(use, site));
  const isBound = built.some(name => isSameBinding(site.checker, arg, name));
  return uses.length === 2 && isBound;
}

/**
 * Whether a `newContext` mention is a call with one untouched builder result.
 *
 * @param mention - A `newContext` name node.
 * @param site - The file under check.
 * @returns True for `x.newContext(<untouched builder const>)`.
 */
function isBuiltContext(mention: ts.Node, site: IContextSite): boolean {
  return calleeOf(mention).some(call => {
    const [arg] = call.arguments;
    const isSole = call.arguments.length === 1 && ts.isIdentifier(arg);
    return isSole && isUntouchedBuild(arg, site);
  });
}

/**
 * Whether a `newPage` mention is a call on a playwright `BrowserContext`.
 *
 * @param mention - A `newPage` name node.
 * @param site - The file under check.
 * @returns True when the checker types the receiver as a context.
 */
function isContextPage(mention: ts.Node, site: IContextSite): boolean {
  return calleeOf(mention).some(call => {
    const receiver = receiverOf(call);
    const symbol = site.checker.getTypeAtLocation(receiver).getSymbol();
    if (symbol === undefined) return false;
    const home = homeOf(symbol);
    return symbol.name === CONTEXT_TYPE && home.includes(CONTEXT_TYPE_HOME);
  });
}

/**
 * A persistent context never takes builder options.
 *
 * @returns False.
 */
function isNeverSafe(): boolean {
  return false;
}

/** Per context-creating name: when one mention of it is safe. */
const MENTION_RULES: Readonly<Record<string, MentionRule>> = {
  newContext: isBuiltContext,
  newPage: isContextPage,
  launchPersistentContext: isNeverSafe,
};

/**
 * One file of a program, ready to check.
 *
 * @param scan - The program and repo root.
 * @param fileName - A root file of the program.
 * @returns The site; throws when the program lacks the file.
 */
function siteOf(scan: IContextProgram, fileName: string): IContextSite {
  const tree = scan.program.getSourceFile(fileName);
  if (tree === undefined) throw new RangeError(`not in the program: ${fileName}`);
  const checker = scan.program.getTypeChecker();
  const builders = BUILDER_MODULES.map(module => join(scan.root, module).replaceAll('\\', '/'));
  return { tree, checker, builders };
}

/**
 * Whether a node names a context-creating member in an unsafe way.
 *
 * @param node - A syntax node.
 * @param site - The file under check.
 * @returns True for a mention its rule rejects.
 */
function isUnsafeMention(node: ts.Node, site: IContextSite): boolean {
  const name = mentionName(node);
  if (!Object.hasOwn(MENTION_RULES, name)) return false;
  return !MENTION_RULES[name](node, site);
}

/**
 * Where a file creates a context whose options do not come from a builder.
 *
 * @param scan - The program and repo root.
 * @param fileName - A root file of the program.
 * @returns One `file:line name` finding per unsafe mention.
 */
function contextFindings(scan: IContextProgram, fileName: string): string[] {
  const site = siteOf(scan, fileName);
  const { tree } = site;
  const unsafe = codeNodes(tree, tree).filter(node => isUnsafeMention(node, site));
  const rel = relative(scan.root, tree.fileName);
  return unsafe.map(node => {
    const start = node.getStart(tree);
    const { line } = tree.getLineAndCharacterOfPosition(start);
    return `${rel}:${String(line + 1)} ${node.getText(tree)}`;
  });
}

/**
 * How many `newContext` calls a file makes with untouched builder options.
 *
 * @param scan - The program and repo root.
 * @param fileName - A root file of the program.
 * @returns The count.
 */
function builtContextCount(scan: IContextProgram, fileName: string): number {
  const site = siteOf(scan, fileName);
  const mentions = codeNodes(site.tree, site.tree).filter(n => mentionName(n) === 'newContext');
  return mentions.filter(mention => isBuiltContext(mention, site)).length;
}

export type { IContextProgram };
export { builtContextCount, CONTEXT_NAME_RE, contextFindings };
