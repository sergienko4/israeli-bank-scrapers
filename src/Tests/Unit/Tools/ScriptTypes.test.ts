/**
 * Invariant test: no script under `scripts/` declares a value as `any`.
 *
 * <p>The repo forbids `any` (CLAUDE.md, "TypeScript strict"), but
 * `tsconfig.json` compiles only `src/` and `npm run lint` lints only `src/`,
 * so `no-explicit-any` never sees the gate scripts. For a plain `.mjs` or
 * `.cjs` script the JSDoc is the only type contract it has; for a `.ts` or
 * declaration file it is the code itself. This test carries the rule into
 * `scripts/`: it parses each script with TypeScript, JSDoc included, and
 * fails on every `any` keyword in the syntax tree. The parser, not a regex,
 * decides what is a type: a quoted brace inside a JSDoc type, code inside a
 * template substitution and multi-line object types are read as types, while
 * strings, comments, prose and an identifier named `any` are not. A `{…}`
 * type under a tag TypeScript does not know (a `@property` outside a
 * `@typedef`, say) is never parsed, so it fails as unread rather than passing
 * unchecked.
 *
 * <p>The scan is pinned by positive and negative controls first, and the
 * repo-wide case asserts it actually read the gate scripts' JSDoc types, so a
 * scan that silently matches nothing cannot pass vacuously.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

const REPO_ROOT = process.cwd();
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/** Script sources the walk inspects: every JavaScript and TypeScript flavour. */
const SCRIPT_SOURCE = /\.[cm]?[jt]s$/u;

/** TypeScript sources; every other script parses as JavaScript. */
const TS_SOURCE = /\.[cm]?ts$/u;

/**
 * Parse a script; the tree includes its JSDoc type expressions.
 * @param file - Repo-relative path, which decides the language.
 * @param source - The whole file.
 * @returns The syntax tree, with parents set.
 */
function parseScript(file: string, source: string): ts.SourceFile {
  const isTypeScript = TS_SOURCE.test(file);
  const kind = isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

/** Which syntax nodes a walk collects. */
type NodeTest = (node: ts.Node) => boolean;

/**
 * Every node under a syntax node that passes a test, JSDoc included.
 * @param node - A syntax node.
 * @param tree - The source file holding it.
 * @param isMatch - Which nodes to collect.
 * @returns The matching nodes, in source order.
 */
function nodesWhere(node: ts.Node, tree: ts.SourceFile, isMatch: NodeTest): ts.Node[] {
  const own = isMatch(node) ? [node] : [];
  const children = node.getChildren(tree);
  const nested = children.flatMap((child: ts.Node): ts.Node[] => nodesWhere(child, tree, isMatch));
  return [...own, ...nested];
}

/**
 * Whether a node is a tag TypeScript does not know that opens with a `{…}`
 * type, which the parser leaves unread.
 * @param node - A syntax node.
 * @returns True for such a tag.
 */
function isUnreadType(node: ts.Node): boolean {
  const comment = ts.isJSDocUnknownTag(node) ? ts.getTextOfJSDocComment(node.comment) : '';
  const text = comment ?? '';
  return text.trimStart().startsWith('{');
}

/**
 * Whether a node declares `any` or holds a type the parser never read.
 * @param node - A syntax node.
 * @returns True for a finding.
 */
function isFinding(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.AnyKeyword || isUnreadType(node);
}

/**
 * Whether a node is a JSDoc type expression the parser read.
 * @param node - A syntax node.
 * @returns True for a JSDoc type expression.
 */
function isJsDocType(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.JSDocTypeExpression;
}

/**
 * Every place a file declares a value as `any`, in code or in JSDoc, and
 * every JSDoc type the parser left unread.
 * @param file - Repo-relative path, used in findings and to pick the language.
 * @param source - The whole file.
 * @returns One finding per such node, with the line that holds it.
 */
function anyFindings(file: string, source: string): string[] {
  const tree = parseScript(file, source);
  const lines = source.split('\n');
  const hits = nodesWhere(tree, tree, isFinding);
  return hits.map((hit: ts.Node): string => {
    const start = hit.getStart(tree);
    const { line } = tree.getLineAndCharacterOfPosition(start);
    return `${file}:${String(line + 1)} ${lines[line].trim()}`;
  });
}

/**
 * How many JSDoc type expressions the parser found in a file.
 * @param file - Repo-relative path, which decides the language.
 * @param source - The whole file.
 * @returns The count.
 */
function jsDocTypeCount(file: string, source: string): number {
  const tree = parseScript(file, source);
  const types = nodesWhere(tree, tree, isJsDocType);
  return types.length;
}

/**
 * Every script source under a directory, recursively.
 * @param dir - Absolute directory to walk.
 * @returns Absolute paths of the script sources.
 */
function scriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry: fs.Dirent): string[] => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(full);
    return SCRIPT_SOURCE.test(entry.name) ? [full] : [];
  });
}

/**
 * The `any` keyword. TypeScript fixtures write it as `ANY`, because the
 * decoupling gate counts `any` usages by their text, string literals too.
 */
const ANY_KEYWORD = 'any';

/**
 * A fixture with each `ANY` placeholder spelled as the `any` keyword.
 * @param text - Fixture text.
 * @returns The text the scan reads.
 */
function spelled(text: string): string {
  return text.replaceAll(/\bANY\b/gu, ANY_KEYWORD);
}

/** Sources that declare `any` somewhere the scan must see it. */
const FLAGGED: readonly (readonly [string, string, string])[] = [
  ['a bare JSDoc type', 'a.mjs', 'const v = /** @type {any} */ (x);'],
  ['a generic argument', 'a.mjs', '/** @param {Array<any>} xs - Items. */'],
  ['an array suffix', 'a.cjs', '/**\n * @property {any[]} list - Items.\n */'],
  ['a record value', 'a.mjs', '/** @typedef {Record<string, any>} Bag */'],
  ['a nested object type', 'a.mjs', '/** @returns {{ a: { b: any } }} Out. */'],
  ['a multi-line object type', 'a.mjs', '/**\n * @param {{\n *   b: any\n * }} x - In.\n */'],
  ['a declaration-file parameter', 'a.d.mts', 'export function f(x: ANY): void;'],
  ['a TypeScript cast', 'a.ts', 'const v = x as ANY;'],
  ['a cast inside a template substitution', 'a.ts', 'const s = `${v as ANY}`;'],
  ['a cast inside a nested template', 'a.ts', 'const s = `a${`b${v as ANY}`}`;'],
  ['a cast after a regex holding a quote', 'a.ts', "const r = /'/u, v = x as ANY, s = 'k';"],
  ['a TypeScript JSDoc type, once', 'a.ts', '/** @type {any} */\nconst v = 1;'],
  ['a JSDoc type after a quoted brace', 'a.mjs', '/** @type {Record<"}", any>} */\nconst v = {};'],
  ['a type under a tag the parser skips', 'a.mjs', '/** @yields {string} x */\nfunction* g() {}'],
];

/** Sources that mention the word but declare no `any` type. */
const CLEAN: readonly (readonly [string, string, string])[] = [
  ['prose in a JSDoc summary', 'a.mjs', '/** Rejects any unexpected input. */'],
  ['prose after the type', 'a.mjs', '/** @param {Company} c - Any company at all. */'],
  ['a longer word', 'a.mjs', '/** @type {Many | anything} */'],
  ['a declaration-file comment', 'a.d.mts', '/** Never returns any. */\nexport const x: string;'],
  ['a TypeScript string', 'a.ts', "const label: string = 'any';"],
  ['untyped JavaScript code', 'a.mjs', 'const any = 1;'],
  ['a TypeScript template text', 'a.ts', 'const s = `any ${v} any`;'],
  ['a TypeScript comment', 'a.ts', '// any\nconst x = 1; /* any */'],
  ['a TypeScript identifier', 'a.ts', 'const any = 1;'],
  ['JSDoc-like text in a JavaScript string', 'a.mjs', "const s = '/** @type {any} */';"],
  ['a call under a tag the parser skips', 'a.mjs', '/** @example f({ a: 1 }) */\nfunction f() {}'],
];

describe('script type scan — extractor controls', () => {
  it.each(FLAGGED)('[SCT-1] flags %s', (_name: string, file: string, source: string) => {
    const code = spelled(source);
    const findings = anyFindings(file, code);
    expect(findings).toHaveLength(1);
  });

  it.each(CLEAN)('[SCT-2] ignores %s', (_name: string, file: string, source: string) => {
    const findings = anyFindings(file, source);
    expect(findings).toEqual([]);
  });

  it('[SCT-3] reports the line that holds the keyword', () => {
    const findings = anyFindings('a.mjs', '\n\n/**\n * @param {{\n *   b: any\n * }} x - In.\n */');
    const expected = spelled('a.mjs:5 *   b: ANY');
    expect(findings).toEqual([expected]);
  });
});

describe('scripts/ declares no any', () => {
  const files = scriptFiles(SCRIPTS_DIR);
  const relative = files.map((file: string): string => path.relative(REPO_ROOT, file));
  const sources = files.map((file: string): string => fs.readFileSync(file, 'utf8'));

  it('[SCT-4] reads the gate scripts and their JSDoc types', () => {
    const counts = relative.map((file: string, index: number): number =>
      jsDocTypeCount(file, sources[index]),
    );
    const typeCount = counts.reduce((sum: number, count: number): number => sum + count, 0);
    const gateCli = path.join('scripts', 'check-browser-stack.mjs');
    const jugglerTypes = path.join('scripts', 'browser-stack', 'juggler-types.mjs');
    expect(relative).toContain(gateCli);
    expect(relative).toContain(jugglerTypes);
    expect(typeCount).toBeGreaterThan(100);
  });

  it('[SCT-5] no JSDoc type or TypeScript code names any', () => {
    const findings = relative.flatMap((file: string, index: number): string[] =>
      anyFindings(file, sources[index]),
    );
    expect(findings).toEqual([]);
  });
});
