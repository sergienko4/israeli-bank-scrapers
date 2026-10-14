/**
 * Invariant test: no script under `scripts/` declares a value as `any`.
 *
 * <p>The repo forbids `any` (CLAUDE.md, "TypeScript strict"), but
 * `tsconfig.json` compiles only `src/` and `npm run lint` lints only `src/`,
 * so `no-explicit-any` never sees the gate scripts. For a plain `.mjs` or
 * `.cjs` script the JSDoc is the only type contract it has; for a `.ts` or
 * declaration file it is the code itself. This test carries the rule into
 * `scripts/`: it walks the tree, extracts every JSDoc type expression (brace
 * balanced, so `{{ a: any }}` and multi-line object types are caught) and,
 * for TypeScript sources, every code line with comments and strings blanked,
 * and fails on the word `any`.
 *
 * <p>The extractor is pinned by positive and negative controls first, and the
 * repo-wide case asserts it actually read the gate scripts, so a scanner that
 * silently matches nothing cannot pass vacuously.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = process.cwd();
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/** Script sources the walk inspects: every JavaScript and TypeScript flavour. */
const SCRIPT_SOURCE = /\.[cm]?[jt]s$/u;

/** TypeScript sources, whose code (not only their JSDoc) carries types. */
const TS_SOURCE = /\.[cm]?ts$/u;

/** A JSDoc block, including the one-line kind that precedes an inline cast. */
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//gu;

/** A block tag that opens a type expression, e.g. `@param {` or `@returns{`. */
const TYPE_TAG = /@[a-z]+\s*\{/gu;

/** Strings and comments in one left-to-right pass, so a `//` inside a URL stays a string. */
const NON_CODE =
  /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;

/** The forbidden type, as a whole word so `Many` or `anything` stay legal. */
const ANY_TYPE = /\bany\b/u;

/** How each character moves the brace depth of a type expression. */
const BRACE_STEP: Readonly<Record<string, number>> = { '{': 1, '}': -1 };

/** A JSDoc type expression and the 1-based line its opening brace sits on. */
interface ITypeExpression {
  readonly line: number;
  readonly text: string;
}

/**
 * The 1-based line number of a character offset.
 * @param source - The whole file.
 * @param offset - A character offset into it.
 * @returns The line holding that offset.
 */
function lineAt(source: string, offset: number): number {
  const before = source.slice(0, offset);
  return before.split('\n').length;
}

/**
 * The brace-balanced type expression whose `{` sits at `open`.
 * @param text - The JSDoc block holding the expression.
 * @param open - Offset of the opening brace.
 * @returns The expression including both braces (the rest if never closed).
 */
function balancedBraces(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    depth += BRACE_STEP[text[index]] ?? 0;
    if (depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

/**
 * Every type expression inside one JSDoc block.
 * @param source - The whole file, for line numbers.
 * @param block - One JSDoc block match.
 * @returns The block's type expressions.
 */
function typesIn(source: string, block: RegExpMatchArray): ITypeExpression[] {
  const base = block.index ?? 0;
  const tags = [...block[0].matchAll(TYPE_TAG)];
  return tags.map((tag: RegExpMatchArray): ITypeExpression => {
    const open = (tag.index ?? 0) + tag[0].length - 1;
    const line = lineAt(source, base + open);
    return { line, text: balancedBraces(block[0], open) };
  });
}

/**
 * Every JSDoc type expression in a file.
 * @param source - The whole file.
 * @returns The type expressions, in file order.
 */
function jsDocTypes(source: string): ITypeExpression[] {
  const blocks = [...source.matchAll(JSDOC_BLOCK)];
  return blocks.flatMap((block: RegExpMatchArray): ITypeExpression[] => typesIn(source, block));
}

/**
 * Blank a non-code span but keep its newlines, so line numbers survive.
 * @param span - A string literal or comment.
 * @returns The span with every other character turned into a space.
 */
function blank(span: string): string {
  return span.replace(/[^\n]/gu, ' ');
}

/**
 * The `any` findings in the code of a TypeScript source.
 * @param file - Repo-relative path, which also decides whether code is typed.
 * @param source - The whole file.
 * @returns One finding per code line naming `any`.
 */
function codeFindings(file: string, source: string): string[] {
  if (!TS_SOURCE.test(file)) return [];
  const lines = source.replace(NON_CODE, blank).split('\n');
  return lines.flatMap((line: string, index: number): string[] =>
    ANY_TYPE.test(line) ? [`${file}:${String(index + 1)} code ${line.trim()}`] : [],
  );
}

/**
 * Every place a file declares a value as `any`.
 * @param file - Repo-relative path, used in findings and to detect TypeScript.
 * @param source - The whole file.
 * @returns Human-readable findings; empty when the file is clean.
 */
function anyFindings(file: string, source: string): string[] {
  const docHits = jsDocTypes(source)
    .filter((type: ITypeExpression): boolean => ANY_TYPE.test(type.text))
    .map((type: ITypeExpression): string => `${file}:${String(type.line)} JSDoc ${type.text}`);
  const codeHits = codeFindings(file, source);
  return [...docHits, ...codeHits];
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

/** Sources that declare `any` somewhere the scan must see it. */
const FLAGGED: readonly (readonly [string, string, string])[] = [
  ['a bare JSDoc type', 'a.mjs', 'const v = /** @type {any} */ (x);'],
  ['a generic argument', 'a.mjs', '/** @param {Array<any>} xs - Items. */'],
  ['an array suffix', 'a.cjs', '/**\n * @property {any[]} list - Items.\n */'],
  ['a record value', 'a.mjs', '/** @typedef {Record<string, any>} Bag */'],
  ['a nested object type', 'a.mjs', '/** @returns {{ a: { b: any } }} Out. */'],
  ['a multi-line object type', 'a.mjs', '/**\n * @param {{\n *   b: any\n * }} x - In.\n */'],
  ['a declaration-file parameter', 'a.d.mts', 'export function f(x: any): void;'],
  ['a TypeScript cast', 'a.ts', 'const v = x as any;'],
];

/** Sources that mention the word but declare no `any` type. */
const CLEAN: readonly (readonly [string, string, string])[] = [
  ['prose in a JSDoc summary', 'a.mjs', '/** Rejects any unexpected input. */'],
  ['prose after the type', 'a.mjs', '/** @param {Company} c - Any company at all. */'],
  ['a longer word', 'a.mjs', '/** @type {Many | anything} */'],
  ['a declaration-file comment', 'a.d.mts', '/** Never returns any. */\nexport const x: string;'],
  ['a TypeScript string', 'a.ts', "const label: string = 'any';"],
  ['untyped JavaScript code', 'a.mjs', 'const any = 1;'],
];

describe('script type scan — extractor controls', () => {
  it.each(FLAGGED)('[SCT-1] flags %s', (_name: string, file: string, source: string) => {
    const findings = anyFindings(file, source);
    expect(findings).toHaveLength(1);
  });

  it.each(CLEAN)('[SCT-2] ignores %s', (_name: string, file: string, source: string) => {
    const findings = anyFindings(file, source);
    expect(findings).toEqual([]);
  });

  it('[SCT-3] reports the line of the opening brace', () => {
    const findings = anyFindings('a.mjs', '\n\n/**\n * @param {any} x - In.\n */');
    expect(findings).toEqual(['a.mjs:4 JSDoc {any}']);
  });
});

describe('scripts/ declares no any', () => {
  const files = scriptFiles(SCRIPTS_DIR);
  const relative = files.map((file: string): string => path.relative(REPO_ROOT, file));
  const sources = files.map((file: string): string => fs.readFileSync(file, 'utf8'));

  it('[SCT-4] reads the gate scripts and their JSDoc types', () => {
    const typeCount = sources.flatMap(jsDocTypes).length;
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
