/**
 * Spec.txt §1 RC-5 guard — `Types/JsonValue.ts` is the single source
 * of truth for the JSON document algebra.
 *
 * <p>RC-5 declared that the canonical module "replaces the per-file
 * `type JsonValue`" pattern, but the consolidation was started and
 * abandoned: four production modules kept their own declarations and
 * the definitions silently diverged. Values crossing those module
 * boundaries reconciled by structural typing with no check that the
 * definitions agreed — invisible to ESLint, to `tsc`, and to the
 * knowledge graph.
 *
 * <p>The root cause of the regression was the absence of a guard, so
 * this test is the guard: it parses every source file under
 * `src/Scrapers/Pipeline/` and fails when any module other than the
 * canonical one declares a member of the algebra.
 *
 * <p>Detection is AST-based rather than line-based on purpose. A
 * regex scanner is bypassed by ordinary TypeScript that a reviewer
 * would never flag — `type JsonValue<T> = …`, `declare type …`,
 * `export default interface …`, a declaration wrapped across two
 * lines, or one nested in a namespace — and it fires on the same
 * text inside a block comment or a template literal. Walking the
 * parse tree removes both failure modes; the last two cases below
 * pin exactly that.
 *
 * <p>The guard resolves unions, `type` aliases and renamed imports, so
 * none of `JsonUnknown | null`, `type Open = JsonUnknown` or
 * `import type { JsonUnknown as Open }` hides an open input. Names
 * resolve lexically — from the scope that uses the name outward to the
 * nearest declaration — so a `namespace` reusing a name shadows nothing
 * outside itself. A renamed import is read off the import clause, which
 * spells the exported name, so no other module has to be parsed to
 * resolve it. What remains outside reach is an alias re-exported under
 * a *second* name by an intermediate module: following that needs a
 * whole-program {@link ts.TypeChecker}, which would mean type-resolving
 * ~870 files inside a unit test. The cost is not justified while the
 * algebra names are the vocabulary reviewers already read for, and the
 * single-declaration-site case above keeps those names in one module.
 *
 * <p>Applicable guidelines:
 * <ul>
 *   <li>`test-guidlines.md` — "Every failure must be actionable":
 *       the assertion message names the offending file, line, and
 *       symbol.</li>
 *   <li>`general-rules-guidlines.md` — "every abstraction must be
 *       testable and strongly typed."</li>
 * </ul>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const CANONICAL_REL = path.join('Types', 'JsonValue.ts');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

/** Algebra members that may only be declared by the canonical module. */
const OWNED_SYMBOLS = [
  'JsonValue',
  'IJsonObject',
  'JsonArray',
  'JsonScalar',
  'JsonObject',
  'JsonUnknown',
  'JsonUnknownRecord',
  'JsonUnknownList',
] as const;

/** Widened view of {@link OWNED_SYMBOLS} for membership tests. */
const OWNED_NAMES: readonly string[] = OWNED_SYMBOLS;

/**
 * Arms of the algebra that promise a *recursively* closed document —
 * every nested value is itself a {@link JsonValue}.
 */
const CLOSED_NAMES: readonly string[] = [
  'JsonValue',
  'IJsonObject',
  'JsonArray',
  'JsonScalar',
  'JsonObject',
];

/** Arms that carry an un-narrowed value, e.g. straight from `JSON.parse`. */
const OPEN_NAMES: readonly string[] = ['JsonUnknown', 'JsonUnknownRecord', 'JsonUnknownList'];

/** One algebra declaration located in a source file. */
interface ISymbolDecl {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
}

/** A type predicate that promises more than it verifies. */
interface IUnsoundGuard {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

/** One `type X = …` alias, tagged with the scope that declares it. */
interface IAlias {
  readonly name: string;
  readonly targets: readonly string[];
  readonly scope: ts.Node;
}

/** Every alias a file declares, in source order. */
type AliasTable = readonly IAlias[];

/** The alias table plus the names already expanded on this path. */
interface IResolve {
  readonly table: AliasTable;
  readonly seen: Set<string>;
}

/** Everything the guard walk needs to know about the file it scans. */
interface IScanCtx {
  readonly source: ts.SourceFile;
  readonly aliases: AliasTable;
}

/**
 * Recursively collect every parseable source file under a root.
 * @param dir - Directory to walk.
 * @returns Absolute paths of the discovered source files.
 */
function listSourceFiles(dir: string): readonly string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = listSourceFiles(full);
      results.push(...nested);
      continue;
    }
    const isSource = SOURCE_EXTENSIONS.some((ext): boolean => entry.name.endsWith(ext));
    if (entry.isFile() && isSource) results.push(full);
  }
  return results;
}

/**
 * Identify a node that declares one of the owned algebra members.
 *
 * <p>Covers `type X = …` and `interface X …` in every position the
 * parser accepts them — exported or not, `declare`d or not, default
 * exported, generic, and nested inside a namespace or module block.
 *
 * @param node - Any node in the parse tree.
 * @param source - Owning source file, used to resolve line numbers.
 * @returns A single-element list when the node declares an owned
 *   symbol, otherwise the empty list.
 */
function ownedDeclOf(node: ts.Node, source: ts.SourceFile): readonly ISymbolDecl[] {
  const isDecl = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
  if (!isDecl) return [];
  const symbol = node.name.text;
  if (!OWNED_NAMES.includes(symbol)) return [];
  const start = node.name.getStart(source);
  const position = source.getLineAndCharacterOfPosition(start);
  return [{ file: source.fileName, line: position.line + 1, symbol }];
}

/**
 * Walk a parse tree collecting every owned declaration it contains.
 * @param node - Subtree root.
 * @param source - Owning source file.
 * @returns Declarations found in this subtree, in source order.
 */
function collectDecls(node: ts.Node, source: ts.SourceFile): readonly ISymbolDecl[] {
  const own = ownedDeclOf(node, source);
  const children = node.getChildren(source);
  const nested = children.flatMap((child): readonly ISymbolDecl[] => collectDecls(child, source));
  return [...own, ...nested];
}

/**
 * Collect algebra declarations contained in a single source file.
 * @param file - Absolute path of the file to inspect.
 * @returns Every owned symbol the file declares locally.
 */
function findDecls(file: string): readonly ISymbolDecl[] {
  const raw = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  const decls = collectDecls(source, source);
  const rel = path.relative(PIPELINE_ROOT, file);
  return decls.map((decl): ISymbolDecl => ({ ...decl, file: rel }));
}

/**
 * Parse an inline fixture and list the owned symbols it declares.
 * @param code - TypeScript source text.
 * @returns Declared owned symbol names, sorted.
 */
function declaredSymbolsIn(code: string): readonly string[] {
  const source = ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true);
  const decls = collectDecls(source, source);
  const symbols = decls.map((decl): string => decl.symbol);
  return symbols.sort();
}

/**
 * Render offenders as a stable, reviewable failure message.
 * @param decls - Declarations found outside the canonical module.
 * @returns One `file:line — symbol` entry per line.
 */
function describeDecls(decls: readonly ISymbolDecl[]): string {
  const rendered = decls.map((d): string => `  ${d.file}:${String(d.line)} — ${d.symbol}`);
  return rendered.join('\n');
}

/**
 * Read every type name a declared annotation references.
 *
 * <p>Parentheses and unions are unwrapped so an author cannot dodge
 * the check by widening the input: `JsonUnknown | null` still reports
 * `JsonUnknown`. Takes a plain node so callers can pass a harmless
 * stand-in when the annotation is absent — anything that is not a type
 * reference contributes nothing.
 *
 * @param node - Declared type node, or any stand-in node.
 * @returns Referenced identifiers, in source order.
 */
function typeNamesOf(node: ts.Node): readonly string[] {
  if (ts.isParenthesizedTypeNode(node)) return typeNamesOf(node.type);
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(typeNamesOf);
  if (!ts.isTypeReferenceNode(node)) return [];
  if (!ts.isIdentifier(node.typeName)) return [];
  return [node.typeName.text];
}

/**
 * Read a renamed import as an alias of the name it was exported under.
 *
 * <p>`import type { JsonUnknown as Open }` renames an open arm exactly
 * as `type Open = JsonUnknown` does, but leaves no alias declaration
 * for the walk below to find. The exported name is written in the
 * clause, so recognising this case is a lookup on the specifier rather
 * than a type resolution — the module the name travels from never has
 * to be read. An import binds for the whole file, so the entry is
 * scoped to the file and any nearer declaration still wins.
 *
 * @param node - Node to inspect.
 * @param source - Owning source file, the scope an import binds in.
 * @returns The single alias this import introduces, else nothing.
 */
function importAliasOf(node: ts.Node, source: ts.SourceFile): AliasTable {
  if (!ts.isImportSpecifier(node)) return [];
  const exported = node.propertyName;
  if (exported === undefined) return [];
  return [{ name: node.name.text, targets: [exported.text], scope: source }];
}

/**
 * Read the alias, if any, that one node introduces.
 * @param node - Node to inspect.
 * @param source - Owning source file.
 * @returns The alias declared by this node, else nothing.
 */
function aliasOf(node: ts.Node, source: ts.SourceFile): AliasTable {
  if (!ts.isTypeAliasDeclaration(node)) return importAliasOf(node, source);
  return [{ name: node.name.text, targets: typeNamesOf(node.type), scope: node.parent }];
}

/**
 * Collect every alias declared beneath a node.
 *
 * <p>An alias is otherwise a blind spot: `type Open = JsonUnknown`
 * renames an open arm, and a check that compares bare identifier text
 * stops matching. Each entry keeps the node that lexically contains it
 * so a name can later be resolved from the scope that uses it rather
 * than from whichever declaration the walk happens to reach last.
 *
 * @param node - Subtree root.
 * @param source - Owning source file.
 * @returns Aliases found in this subtree, in source order.
 */
function collectAliases(node: ts.Node, source: ts.SourceFile): AliasTable {
  const own = aliasOf(node, source);
  const children = node.getChildren(source);
  const nested = children.flatMap((c): AliasTable => collectAliases(c, source));
  return [...own, ...nested];
}

/**
 * List a node's enclosing scopes, innermost first.
 * @param node - Node to start from.
 * @returns The node and each of its ancestors, up to the file.
 */
function scopeChainOf(node: ts.Node): readonly ts.Node[] {
  if (ts.isSourceFile(node)) return [node];
  const outer = scopeChainOf(node.parent);
  return [node, ...outer];
}

/**
 * Resolve one alias name as the code at a given node would see it.
 *
 * <p>A `namespace` may reuse a name the surrounding file already
 * declares. Only declarations in an enclosing scope are visible, and
 * the nearest of those wins, so a sibling block cannot redefine a name
 * out from under its neighbours.
 *
 * @param name - Type name as written.
 * @param from - Node whose scope the name is read in.
 * @param table - Aliases declared by the owning file.
 * @returns The visible declaration, or the empty list when none is.
 */
function aliasFor(name: string, from: ts.Node, table: AliasTable): AliasTable {
  const chain = scopeChainOf(from);
  const named = table.filter((a): boolean => a.name === name);
  const perScope = chain.flatMap((scope): AliasTable => {
    return named.filter((a): boolean => a.scope === scope);
  });
  return perScope.slice(0, 1);
}

/**
 * Expand the right-hand side of one alias.
 * @param alias - Alias whose targets are expanded.
 * @param res - Alias table and the names already expanded.
 * @returns The names the alias ultimately denotes.
 */
function expandAlias(alias: IAlias, res: IResolve): readonly string[] {
  return alias.targets.flatMap((next): readonly string[] => expandName(next, alias.scope, res));
}

/**
 * Expand one type name through the aliases visible where it is written.
 * @param name - Type name exactly as written in the annotation.
 * @param from - Node whose scope the name is read in.
 * @param res - Alias table and the names already expanded.
 * @returns The names the annotation ultimately denotes.
 */
function expandName(name: string, from: ts.Node, res: IResolve): readonly string[] {
  if (res.seen.has(name)) return [];
  res.seen.add(name);
  const found = aliasFor(name, from, res.table);
  if (found.length === 0) return [name];
  return found.flatMap((alias): readonly string[] => expandAlias(alias, res));
}

/**
 * Expand every name an annotation references.
 * @param names - Names read straight from the annotation.
 * @param from - Node whose scope the names are read in.
 * @param table - Aliases declared by the owning file.
 * @returns Alias-free type names.
 */
function expandNames(
  names: readonly string[],
  from: ts.Node,
  table: AliasTable,
): readonly string[] {
  const res: IResolve = { table, seen: new Set<string>() };
  return names.flatMap((name): readonly string[] => expandName(name, from, res));
}

/**
 * Find the first name belonging to one arm of the algebra.
 * @param names - Alias-expanded type names.
 * @param arms - Arm names to match against.
 * @returns The matching name, or the empty string when none match.
 */
function firstArm(names: readonly string[], arms: readonly string[]): string {
  const match = names.find((name): boolean => arms.includes(name));
  return match ?? '';
}

/**
 * Resolve the declared type names of the parameter a predicate narrows.
 * @param fn - Function-like node carrying a type-predicate return.
 * @param predicate - The predicate return-type node.
 * @returns Declared parameter type names, before alias expansion.
 */
function narrowedParamNames(
  fn: ts.SignatureDeclaration,
  predicate: ts.TypePredicateNode,
): readonly string[] {
  const target = predicate.parameterName;
  if (!ts.isIdentifier(target)) return [];
  const match = fn.parameters.find(
    (p): boolean => ts.isIdentifier(p.name) && p.name.text === target.text,
  );
  if (match === undefined) return [];
  return typeNamesOf(match.type ?? match);
}

/**
 * Read the closed arm a predicate asserts, following aliases.
 * @param predicate - The predicate return-type node.
 * @param ctx - Owning file and its alias table.
 * @returns The asserted closed arm, or the empty string.
 */
function assertedArmOf(predicate: ts.TypePredicateNode, ctx: IScanCtx): string {
  const declared = predicate.type ?? predicate;
  const written = typeNamesOf(declared);
  const expanded = expandNames(written, predicate, ctx.aliases);
  return firstArm(expanded, CLOSED_NAMES);
}

/**
 * Read the open arm a predicate narrows from, following aliases.
 * @param fn - Function-like node carrying the type-predicate return.
 * @param predicate - The predicate return-type node.
 * @param ctx - Owning file and its alias table.
 * @returns The narrowed open arm, or the empty string.
 */
function inputArmOf(
  fn: ts.SignatureDeclaration,
  predicate: ts.TypePredicateNode,
  ctx: IScanCtx,
): string {
  const written = narrowedParamNames(fn, predicate);
  const expanded = expandNames(written, fn, ctx.aliases);
  return firstArm(expanded, OPEN_NAMES);
}

/**
 * Identify a guard that asserts a closed JSON type from an open input.
 *
 * <p>`value is IJsonObject` promises that every nested value is a
 * {@link JsonValue}. A guard that only inspects the outer container
 * cannot establish that, so accepting {@link JsonUnknown} and
 * asserting a closed arm re-introduces the very unsoundness this
 * module's split removed.
 *
 * <p>Both sides are read through {@link expandNames}, so a union arm
 * or a local alias is resolved to the algebra name it denotes rather
 * than compared as bare text.
 *
 * @param node - Any node in the parse tree.
 * @param ctx - Owning file and its alias table.
 * @returns Single-element list when the node is unsound, else empty.
 */
function unsoundGuardOf(node: ts.Node, ctx: IScanCtx): readonly IUnsoundGuard[] {
  if (!ts.isFunctionLike(node)) return [];
  const returned = node.type;
  if (returned === undefined) return [];
  if (!ts.isTypePredicateNode(returned)) return [];
  const closed = assertedArmOf(returned, ctx);
  if (closed === '') return [];
  const open = inputArmOf(node, returned, ctx);
  if (open === '') return [];
  const line = lineOf(node, ctx.source);
  return [{ file: ctx.source.fileName, line, detail: `${open} is ${closed}` }];
}

/**
 * Resolve the 1-based line a node starts on.
 * @param node - Node to locate.
 * @param source - Owning source file.
 * @returns 1-based line number.
 */
function lineOf(node: ts.Node, source: ts.SourceFile): number {
  const start = node.getStart(source);
  const position = source.getLineAndCharacterOfPosition(start);
  return position.line + 1;
}

/**
 * Walk a parse tree collecting every unsound guard it contains.
 * @param node - Subtree root.
 * @param ctx - Owning file and its alias table.
 * @returns Offending guards found in this subtree, in source order.
 */
function collectGuards(node: ts.Node, ctx: IScanCtx): readonly IUnsoundGuard[] {
  const own = unsoundGuardOf(node, ctx);
  const children = node.getChildren(ctx.source);
  const nested = children.flatMap((c): readonly IUnsoundGuard[] => collectGuards(c, ctx));
  return [...own, ...nested];
}

/**
 * Build the scan context for a parsed file.
 * @param source - Parsed source file.
 * @returns The file paired with the aliases it declares.
 */
function scanCtxOf(source: ts.SourceFile): IScanCtx {
  return { source, aliases: collectAliases(source, source) };
}

/**
 * Collect unsound guards declared in a single source file.
 * @param file - Absolute path of the file to inspect.
 * @returns Every offending guard, with paths relative to the root.
 */
function findGuards(file: string): readonly IUnsoundGuard[] {
  const raw = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  const ctx = scanCtxOf(source);
  const guards = collectGuards(source, ctx);
  const rel = path.relative(PIPELINE_ROOT, file);
  return guards.map((guard): IUnsoundGuard => ({ ...guard, file: rel }));
}

/**
 * Parse an inline fixture and list the unsound guards it contains.
 * @param code - TypeScript source text.
 * @returns One `input is asserted` entry per offending guard.
 */
function guardDetailsIn(code: string): readonly string[] {
  const source = ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true);
  const ctx = scanCtxOf(source);
  const guards = collectGuards(source, ctx);
  return guards.map((guard): string => guard.detail);
}

/**
 * Render unsound guards as a stable, reviewable failure message.
 * @param guards - Offending guards.
 * @returns One `file:line — narrowing` entry per line.
 */
function describeGuards(guards: readonly IUnsoundGuard[]): string {
  const rendered = guards.map((g): string => `  ${g.file}:${String(g.line)} — ${g.detail}`);
  return rendered.join('\n');
}

describe('RC-5 — JsonValue single source of truth', () => {
  const sourceFiles = listSourceFiles(PIPELINE_ROOT);

  it('finds the pipeline sources it is meant to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it('keeps the canonical module as the only declaration site', () => {
    const strayFiles = sourceFiles.filter(
      (file): boolean => path.relative(PIPELINE_ROOT, file) !== CANONICAL_REL,
    );
    const strays = strayFiles.flatMap(findDecls);
    const rendered = describeDecls(strays);
    expect(rendered).toBe('');
  });

  it('declares every owned symbol in the canonical module', () => {
    const canonical = path.join(PIPELINE_ROOT, CANONICAL_REL);
    const decls = findDecls(canonical);
    const declared = decls.map((decl): string => decl.symbol).sort();
    const expected = [...OWNED_SYMBOLS].sort();
    expect(declared).toStrictEqual(expected);
  });

  it('detects declaration forms a line scanner would miss', () => {
    const evasive = [
      'export type JsonValue<T> = T;',
      'declare type JsonArray = readonly unknown[];',
      'export default interface IJsonObject {}',
      "declare module 'vendor' { type JsonScalar = string; }",
      'namespace Nested { export type JsonObject = object; }',
    ].join('\n');
    const symbols = declaredSymbolsIn(evasive);
    expect(symbols).toStrictEqual([
      'IJsonObject',
      'JsonArray',
      'JsonObject',
      'JsonScalar',
      'JsonValue',
    ]);
  });

  /**
   * `type` is a contextual keyword: TypeScript only starts a type-alias
   * when an identifier follows it on the SAME line. `type\nJsonValue = …`
   * therefore declares nothing, so the walker is right to skip it.
   */
  it('ignores a line break between "type" and the name, as the parser does', () => {
    const symbols = declaredSymbolsIn('type\n  JsonValue\n  = string;');
    expect(symbols).toStrictEqual([]);
  });

  it('ignores declaration text inside comments and string literals', () => {
    const inert = [
      '/* type JsonValue = never; */',
      '// interface IJsonObject {}',
      'const sample = `type JsonArray = never;`;',
      "const other = 'interface JsonScalar {}';",
    ].join('\n');
    const symbols = declaredSymbolsIn(inert);
    expect(symbols).toStrictEqual([]);
  });

  /**
   * Closing the algebra made `x is IJsonObject` a strictly stronger
   * claim than it was: every nested value must now be a `JsonValue`.
   * A guard that only inspects the outer container cannot establish
   * that, so `{ data: [undefined] }` would satisfy it and smuggle
   * `undefined` into code typed to receive closed JSON. Narrowing an
   * input that is *already* closed stays sound and is untouched here.
   */
  it('never asserts a closed JSON type from an un-narrowed input', () => {
    const guards = sourceFiles.flatMap(findGuards);
    const rendered = describeGuards(guards);
    expect(rendered).toBe('');
  });

  it('flags an open-input guard that asserts a closed arm', () => {
    const offender = 'function f(v: JsonUnknown): v is IJsonObject { return true; }';
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('accepts narrowing that starts from an already-closed input', () => {
    const sound = 'function f(v: JsonValue): v is IJsonObject { return true; }';
    const details = guardDetailsIn(sound);
    expect(details).toStrictEqual([]);
  });

  /**
   * The two evasions a bare-identifier comparison cannot see: an open
   * arm widened into a union, and one renamed by a local alias. Both
   * reach `expandNames`, so the reported detail names the algebra arm
   * rather than the text the author happened to write.
   */
  it('flags an open input widened by a union', () => {
    const offender = 'function f(v: JsonUnknown | null): v is IJsonObject { return true; }';
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('flags an open input hidden behind a local type alias', () => {
    const offender = [
      'type Open = JsonUnknown;',
      'function f(v: Open): v is IJsonObject { return true; }',
    ].join('\n');
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  /**
   * An alias name is only meaningful together with the scope that
   * declares it. Indexing a file's aliases into one flat table lets an
   * unrelated `namespace` redefine a name the surrounding code already
   * uses, and whichever declaration the parser reaches last silently
   * wins. Both fixtures below place the decoy where a source-order
   * table would prefer it, so each one fails unless resolution starts
   * from the guard's own scope and stops at the nearest declaration.
   */
  it('ignores an alias redeclared by an unrelated namespace', () => {
    const offender = [
      'type Open = JsonUnknown;',
      'function f(v: Open): v is IJsonObject { return true; }',
      'namespace Shadow { export type Open = IJsonObject; }',
    ].join('\n');
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('prefers the nearest alias over a later outer declaration', () => {
    const offender = [
      'namespace Inner {',
      '  type Open = JsonUnknown;',
      '  export function f(v: Open): v is IJsonObject { return true; }',
      '}',
      'type Open = IJsonObject;',
    ].join('\n');
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  /**
   * A renamed import is the cross-module twin of a local alias, and
   * the one form of it that costs nothing to resolve: the import
   * clause spells the exported name, so the guard reads it off the
   * specifier instead of resolving the module. The third fixture pins
   * the boundary that remains — a name re-exported under a *second*
   * name by an intermediate module is not followed, because only a
   * whole-program checker could say what it denotes.
   */
  it('flags an open input hidden behind a renamed import', () => {
    const offender = [
      "import type { JsonUnknown as Open } from '../../Types/JsonValue.js';",
      'function f(v: Open): v is IJsonObject { return true; }',
    ].join('\n');
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('prefers a local alias over a renamed import of the same name', () => {
    const offender = [
      "import type { IJsonObject as Open } from '../../Types/JsonValue.js';",
      'namespace Inner {',
      '  type Open = JsonUnknown;',
      '  export function f(v: Open): v is IJsonObject { return true; }',
      '}',
    ].join('\n');
    const details = guardDetailsIn(offender);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('leaves a re-export renamed a second time to the type checker', () => {
    const beyond = [
      "import type { Open } from './Barrel.js';",
      'function f(v: Open): v is IJsonObject { return true; }',
    ].join('\n');
    const details = guardDetailsIn(beyond);
    expect(details).toStrictEqual([]);
  });

  /** Alias expansion must terminate: this gate runs on every commit. */
  it('terminates on a cyclic alias chain', () => {
    const cyclic = [
      'type A = B;',
      'type B = A;',
      'function f(v: A): v is IJsonObject { return true; }',
    ].join('\n');
    const details = guardDetailsIn(cyclic);
    expect(details).toStrictEqual([]);
  });
});
