/**
 * Source-graph construction for decoupling metrics.
 *
 * Builds a file-level import graph directly from TypeScript sources so the
 * metrics stay valid even when the knowledge graph is stale. Resolution
 * understands this project's ESM convention of importing `./Foo.js` from
 * `Foo.ts`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, sep } from 'node:path';
import ts from 'typescript';

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = /^(node_modules|lib|dist|coverage)\//;
const COMMENTS_RE = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/**
 * Strips block and line comments so downstream regexes never match prose.
 *
 * <p>Without this, JSDoc phrasing such as "Best-effort: any throw is
 * swallowed" is counted as a real `: any` type annotation.
 *
 * @param text raw source text
 * @returns the same text with comment bodies removed
 */
export function stripComments(text) {
  return text.replace(COMMENTS_RE, '$1');
}

export const RUNTIME = 'runtime';
export const TYPE_ONLY = 'type';

export const toPosix = p => p.split(sep).join('/');

/**
 * Lists TypeScript sources that git knows about.
 *
 * <p>Walking the filesystem instead swept in gitignored local scratch
 * scripts, so a snapshot encoded whichever untracked files happened to sit
 * in the author's working tree and no other checkout could reproduce it.
 *
 * @param root repository root
 * @returns repo-relative POSIX paths, sorted
 */
export function listSources(root) {
  const args = ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\0').filter(f => SOURCE_EXT.test(f) && !SKIP_DIRS.test(f));
}

/** True when every named binding carries its own `type` keyword. */
function allNamedAreTypes(bindings) {
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly);
}

/**
 * Classifies an import declaration.
 *
 * <p>A default or namespace binding is a runtime value even when the braces
 * beside it list only types, so those forms must never be judged by the
 * named bindings alone.
 */
function importKind(node) {
  const clause = node.importClause;
  if (!clause) return RUNTIME;
  if (clause.isTypeOnly) return TYPE_ONLY;
  if (clause.name) return RUNTIME;
  return allNamedAreTypes(clause.namedBindings) ? TYPE_ONLY : RUNTIME;
}

function exportKind(node) {
  if (node.isTypeOnly) return TYPE_ONLY;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return RUNTIME;
  return clause.elements.every(e => e.isTypeOnly) ? TYPE_ONLY : RUNTIME;
}

function isRequireCall(node) {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function collect(node, out) {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
    out.push({ spec: node.moduleSpecifier.text, kind: importKind(node) });
  else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
    out.push({ spec: node.moduleSpecifier.text, kind: exportKind(node) });
  else if (
    ts.isCallExpression(node) &&
    isRequireCall(node) &&
    ts.isStringLiteral(node.arguments[0])
  )
    out.push({ spec: node.arguments[0].text, kind: RUNTIME });
  ts.forEachChild(node, child => collect(child, out));
}

/**
 * Extracts module specifiers tagged as runtime or type-only.
 *
 * <p>`import type` edges vanish at build time, so counting them as coupling
 * overstates how tangled the runtime graph actually is. Parsing is done with
 * the TypeScript AST because a regex cannot tell where one statement ends
 * and the next begins: a side-effect `import './a';` followed by an
 * `import type` was previously merged into a single mis-typed edge.
 *
 * @param text raw source text
 * @returns one entry per module specifier, in source order
 */
export function extractSpecifiers(text) {
  const sf = ts.createSourceFile('m.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out = [];
  collect(sf, out);
  return out;
}

function candidatesFor(base) {
  const stripped = base.replace(/\.js$/, '');
  const exts = ['.ts', '.tsx', '.mts', '.cts'];
  return [base, ...exts.map(e => stripped + e), ...exts.map(e => `${stripped}/index${e}`)];
}

/** Resolves a relative specifier to a repo-relative source path, or null. */
export function resolveSpecifier(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const base = toPosix(join(dirname(fromFile), spec));
  return candidatesFor(base).find(c => fileSet.has(c)) ?? null;
}

function edgesForFile(root, file, fileSet) {
  const text = readFileSync(join(root, file), 'utf8');
  const strongest = new Map();
  for (const { spec, kind } of extractSpecifiers(text)) {
    const target = resolveSpecifier(file, spec, fileSet);
    if (!target || target === file) continue;
    if (kind === RUNTIME || !strongest.has(target)) strongest.set(target, kind);
  }
  return [...strongest].map(([target, kind]) => [file, target, kind]);
}

function countLines(root, file) {
  const text = readFileSync(join(root, file), 'utf8');
  return text.split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).length;
}

/** Builds `{ files, edges, loc }` for the repo rooted at `root`. */
export function buildGraph(root) {
  const files = listSources(root).sort();
  const fileSet = new Set(files);
  const edges = files.flatMap(f => edgesForFile(root, f, fileSet));
  const loc = new Map(files.map(f => [f, countLines(root, f)]));
  return { files, edges, loc };
}
