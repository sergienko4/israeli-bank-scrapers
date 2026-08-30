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
 * Read the symbol name of a bare type reference.
 *
 * <p>Takes a plain node so callers can pass a harmless stand-in when
 * the annotation is absent — any non-type-reference yields `''`.
 *
 * @param node - Declared type node, or any stand-in node.
 * @returns The referenced identifier, or the empty string.
 */
function typeNameOf(node: ts.Node): string {
  if (!ts.isTypeReferenceNode(node)) return '';
  if (!ts.isIdentifier(node.typeName)) return '';
  return node.typeName.text;
}

/**
 * Resolve the declared type of the parameter a predicate narrows.
 * @param fn - Function-like node carrying a type-predicate return.
 * @param predicate - The predicate return-type node.
 * @returns Declared parameter type name, or the empty string.
 */
function narrowedParamType(fn: ts.SignatureDeclaration, predicate: ts.TypePredicateNode): string {
  const target = predicate.parameterName;
  if (!ts.isIdentifier(target)) return '';
  const wanted = target.text;
  const match = fn.parameters.find(
    (p): boolean => ts.isIdentifier(p.name) && p.name.text === wanted,
  );
  if (match === undefined) return '';
  return typeNameOf(match.type ?? match);
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
 * @param node - Any node in the parse tree.
 * @param source - Owning source file, used to resolve line numbers.
 * @returns Single-element list when the node is unsound, else empty.
 */
function unsoundGuardOf(node: ts.Node, source: ts.SourceFile): readonly IUnsoundGuard[] {
  if (!ts.isFunctionLike(node)) return [];
  const returned = node.type;
  if (returned === undefined) return [];
  if (!ts.isTypePredicateNode(returned)) return [];
  const asserted = typeNameOf(returned.type ?? returned);
  if (!CLOSED_NAMES.includes(asserted)) return [];
  const input = narrowedParamType(node, returned);
  if (!OPEN_NAMES.includes(input)) return [];
  return [{ file: source.fileName, line: lineOf(node, source), detail: `${input} is ${asserted}` }];
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
 * @param source - Owning source file.
 * @returns Offending guards found in this subtree, in source order.
 */
function collectGuards(node: ts.Node, source: ts.SourceFile): readonly IUnsoundGuard[] {
  const own = unsoundGuardOf(node, source);
  const children = node.getChildren(source);
  const nested = children.flatMap((c): readonly IUnsoundGuard[] => collectGuards(c, source));
  return [...own, ...nested];
}

/**
 * Collect unsound guards declared in a single source file.
 * @param file - Absolute path of the file to inspect.
 * @returns Every offending guard, with paths relative to the root.
 */
function findGuards(file: string): readonly IUnsoundGuard[] {
  const raw = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  const guards = collectGuards(source, source);
  const rel = path.relative(PIPELINE_ROOT, file);
  return guards.map((guard): IUnsoundGuard => ({ ...guard, file: rel }));
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
    const source = ts.createSourceFile('fixture.ts', offender, ts.ScriptTarget.Latest, true);
    const guards = collectGuards(source, source);
    const details = guards.map((guard): string => guard.detail);
    expect(details).toStrictEqual(['JsonUnknown is IJsonObject']);
  });

  it('accepts narrowing that starts from an already-closed input', () => {
    const sound = 'function f(v: JsonValue): v is IJsonObject { return true; }';
    const source = ts.createSourceFile('fixture.ts', sound, ts.ScriptTarget.Latest, true);
    const guards = collectGuards(source, source);
    expect(guards).toStrictEqual([]);
  });
});
