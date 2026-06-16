/**
 * SHARED IMPORT-GRAPH SCANNER — filesystem + import-resolution primitives
 * used by the dependency-gate tools (`detect-dead-code` and
 * `lint-import-cycles`).
 *
 * Both gates need the SAME notion of "production source" and the SAME
 * TS/ESM specifier resolution (relative `.js` specifiers resolve to the
 * `.ts` source on disk). Centralising that here keeps the two gates in
 * lock-step instead of each carrying a drifting copy — the very coupling
 * the acyclic-dependencies gate exists to prevent.
 *
 * Pure + side-effect-free at import time: nothing runs until a caller
 * invokes a function, so importing this module is safe from unit tests.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Sentinel returned by {@link resolveImport} for unresolved specifiers. */
export const UNRESOLVED = '' as const;

/** Sentinel returned by {@link walkProdFiles} once recursion completes. */
export type WalkDone = true;

/**
 * Matches static `from '...'` / `import '...'` AND dynamic
 * `import('...')`. The three alternation branches are split so each
 * sub-expression has a single `\s*` anchored against a literal, which
 * keeps the regex free of the polynomial-backtracking pattern the
 * `regexp/no-super-linear-backtracking` rule guards against.
 */
const IMPORT_RE_SOURCE = String.raw`(?:from\s+|import\s+|import\s*\(\s*)['"]([^'"]+)['"]`;

/**
 * Source of the import regex, exported so callers that keep their own
 * regex copy can stay in lock-step with this module.
 */
export const IMPORT_REGEX_SOURCE = IMPORT_RE_SOURCE;

/**
 * Parses every static and dynamic import specifier from a TypeScript source.
 *
 * Exported so the regex can be unit-tested in isolation without spinning
 * up the full filesystem walker.
 *
 * @param src - Raw TypeScript source text.
 * @returns Specifiers in source order (relative or external, unresolved).
 */
export function parseImportSpecifiers(src: string): readonly string[] {
  // Construct a fresh regex per call so concurrent callers cannot
  // collide on the shared `lastIndex` of a global flag.
  const re = new RegExp(IMPORT_RE_SOURCE, 'g');
  const matches = [...src.matchAll(re)];
  return matches.map((m): string => m[1]);
}

/**
 * Decide whether a file counts as production source for the gates.
 * @param file - Absolute file path.
 * @returns True when the file is `.ts` source we should analyse.
 */
export function isProdFile(file: string): boolean {
  if (!file.endsWith('.ts')) return false;
  if (file.endsWith('.d.ts')) return false;
  if (file.endsWith('.test.ts')) return false;
  if (file.endsWith('.canary.ts')) return false;
  if (file.includes(`${path.sep}EslintCanaries${path.sep}fixtures${path.sep}`)) return false;
  if (file.includes(`${path.sep}Tests${path.sep}`)) return false;
  if (file.includes(`${path.sep}coverage${path.sep}`)) return false;
  return true;
}

/**
 * Recursively collect all production `.ts` files under `dir`.
 * @param dir - Directory to walk.
 * @param out - Accumulator (mutated).
 * @returns Sentinel true once recursion completes (no-void rule).
 */
export function walkProdFiles(dir: string, out: string[]): WalkDone {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProdFiles(full, out);
    } else if (isProdFile(full)) {
      out.push(full);
    }
  }
  return true;
}

/**
 * Parse `from '...'` and `import '...'` specifiers from one file.
 * @param file - Absolute file path.
 * @returns Raw specifiers (relative or external).
 */
export function parseImports(file: string): readonly string[] {
  const src = fs.readFileSync(file, 'utf8');
  return parseImportSpecifiers(src);
}

/**
 * Resolve a relative `.js` import (TS/ESM convention) to an absolute
 * `.ts` file on disk. External / unresolved specifiers return the
 * UNRESOLVED sentinel — the empty string can never match a real path
 * so the caller's lookup safely no-ops.
 * @param fromFile - Importer absolute path.
 * @param spec - Raw specifier.
 * @returns Absolute path of the `.ts` source, or UNRESOLVED.
 */
export function resolveImport(fromFile: string, spec: string): string {
  if (!spec.startsWith('.')) return UNRESOLVED;
  const baseDir = path.dirname(fromFile);
  const stripped = spec.endsWith('.js') ? spec.slice(0, -3) : spec;
  const tsPath = path.resolve(baseDir, `${stripped}.ts`);
  if (fs.existsSync(tsPath)) return tsPath;
  const indexPath = path.resolve(baseDir, stripped, 'index.ts');
  if (fs.existsSync(indexPath)) return indexPath;
  return UNRESOLVED;
}
