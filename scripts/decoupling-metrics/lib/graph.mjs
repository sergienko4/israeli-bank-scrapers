/**
 * Source-graph construction for decoupling metrics.
 *
 * Builds a file-level import graph directly from TypeScript sources so the
 * metrics stay valid even when the knowledge graph is stale. Resolution
 * understands this project's ESM convention of importing `./Foo.js` from
 * `Foo.ts`.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'lib',
  'dist',
  'coverage',
  '.understand-anything',
  '.ua',
]);
const STATEMENT_RE = /\b(import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_RE = /(?:\bimport\s*\(|\brequire\s*\(|\bimport\s+)['"]([^'"]+)['"]/g;
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

export const toPosix = (p) => p.split(sep).join('/');

/** Recursively collects repo-relative paths of all TypeScript sources. */
export function walkSources(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(root, full, out);
    else if (SOURCE_EXT.test(entry)) out.push(toPosix(relative(root, full)));
  }
  return out;
}

function isTypeOnlyClause(clause) {
  const text = clause.trim();
  if (text.startsWith('type ')) return true;
  const named = text.match(/\{([\s\S]*)\}/);
  if (!named) return false;
  const parts = named[1].split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => p.startsWith('type '));
}

/**
 * Extracts module specifiers tagged as runtime or type-only.
 *
 * `import type` edges vanish at build time, so counting them as coupling
 * overstates how tangled the runtime graph actually is.
 */
export function extractSpecifiers(text) {
  const code = stripComments(text);
  const out = [...code.matchAll(STATEMENT_RE)].map((m) => ({
    spec: m[3],
    kind: isTypeOnlyClause(m[2]) ? TYPE_ONLY : RUNTIME,
  }));
  for (const m of code.matchAll(BARE_RE)) out.push({ spec: m[1], kind: RUNTIME });
  return out;
}

function candidatesFor(base) {
  const stripped = base.replace(/\.js$/, '');
  const exts = ['.ts', '.tsx', '.mts', '.cts'];
  return [base, ...exts.map((e) => stripped + e), ...exts.map((e) => `${stripped}/index${e}`)];
}

/** Resolves a relative specifier to a repo-relative source path, or null. */
export function resolveSpecifier(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const base = toPosix(join(dirname(fromFile), spec));
  return candidatesFor(base).find((c) => fileSet.has(c)) ?? null;
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
  return text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
}

/** Builds `{ files, edges, loc }` for the repo rooted at `root`. */
export function buildGraph(root) {
  const files = walkSources(root).sort();
  const fileSet = new Set(files);
  const edges = files.flatMap((f) => edgesForFile(root, f, fileSet));
  const loc = new Map(files.map((f) => [f, countLines(root, f)]));
  return { files, edges, loc };
}
