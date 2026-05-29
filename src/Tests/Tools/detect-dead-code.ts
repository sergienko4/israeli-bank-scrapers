/**
 * DEAD-CODE CANARY — fails CI when any production source file under
 * `src/Scrapers/Pipeline/` has zero production importers.
 *
 * "Production" excludes `*.test.ts`, `*.canary.ts`, and EslintCanaries
 * fixtures: a file consumed only by tests is dead from the runtime
 * perspective and should be deleted (Commit H removed
 * `Banks/_Shared/CookieJar.ts` for exactly this reason).
 *
 * Algorithm:
 *   1. Walk `src/` for every `.ts` file (skip tests, canaries, fixtures,
 *      declaration files).
 *   2. Build an import graph: for each prod file, parse `from '...'`
 *      specifiers, resolve to absolute paths, and record edges.
 *   3. For every prod file under `src/Scrapers/Pipeline/`, check the
 *      reverse-edge count. Zero importers AND not an entry point → dead.
 *
 * Entry points (allowed zero importers) live in ENTRY_POINTS. New
 * entries must include a one-line justifying comment.
 *
 * Invoked via `npm run lint:dead-code`; wired into the pre-commit
 * gate ladder so a dead file cannot reach `origin`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = process.cwd();
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const PIPELINE_ROOT = path.join(SRC_ROOT, 'Scrapers', 'Pipeline');

/**
 * Files exempted from the "must have ≥1 importer" rule.
 *
 * Legitimate entry points — public surfaces consumed externally.
 */
const ENTRY_POINTS: ReadonlySet<string> = new Set([
  // Public barrel export — consumed via the npm package's entry.
  path.join(PIPELINE_ROOT, 'index.ts'),
  // Phase 6 scaffolding — Types and Facade are populated across
  // commits 1-5; the production import edges land in commit 5
  // (Facade composes the registry) and commit 6 (PiiRedactor shim
  // re-exports from Facade). Allow zero importers during the staged
  // refactor so the dead-code gate doesn't gate commit 1 to commit 5.
  path.join(PIPELINE_ROOT, 'Types', 'PiiRedactor', 'Facade.ts'),
  path.join(PIPELINE_ROOT, 'Types', 'PiiRedactor', 'Types.ts'),
]);

/** Sentinel returned by {@link resolveImport} for unresolved specifiers. */
const UNRESOLVED = '' as const;
/** Sentinel returned by {@link walk} once recursion completes. */
type WalkDone = true;

/**
 * Decide whether a file counts as production source for the gate.
 * @param file - Absolute file path.
 * @returns True when the file is .ts source we should analyse.
 */
function isProdFile(file: string): boolean {
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
function walk(dir: string, out: string[]): WalkDone {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (isProdFile(full)) {
      out.push(full);
    }
  }
  return true;
}

/**
 * Matches static `from '...'` / `import '...'` AND dynamic
 * `import('...')`. The three alternation branches are split so each
 * sub-expression has a single `\s*` anchored against a literal, which
 * keeps the regex free of the polynomial-backtracking pattern the
 * `regexp/no-super-linear-backtracking` rule guards against.
 */
const IMPORT_RE_SOURCE = String.raw`(?:from\s+|import\s+|import\s*\(\s*)['"]([^'"]+)['"]`;

/**
 * Sentinel returned by {@link parseImportSpecifiers} when the regex
 * exposed by this module is used elsewhere. Exported so callers can
 * keep their own regex copy in lock-step.
 */
export const IMPORT_REGEX_SOURCE = IMPORT_RE_SOURCE;

/**
 * Parses every static and dynamic import specifier from a TypeScript source.
 *
 * Exported so the dead-code regex can be unit-tested in isolation without
 * spinning up the full canary walker.
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
 * Parse `from '...'` and `import '...'` specifiers from one file.
 * @param file - Absolute file path.
 * @returns Raw specifiers (relative or external).
 */
function parseImports(file: string): readonly string[] {
  const src = fs.readFileSync(file, 'utf8');
  return parseImportSpecifiers(src);
}

/**
 * Resolve a relative `.js` import (TS/ESM convention) to an absolute
 * `.ts` file on disk. External / unresolved specifiers return the
 * UNRESOLVED sentinel — the empty string can never match a real path
 * so the caller's import-count lookup safely no-ops.
 * @param fromFile - Importer absolute path.
 * @param spec - Raw specifier.
 * @returns Absolute path of the .ts source, or UNRESOLVED.
 */
function resolveImport(fromFile: string, spec: string): string {
  if (!spec.startsWith('.')) return UNRESOLVED;
  const baseDir = path.dirname(fromFile);
  const stripped = spec.endsWith('.js') ? spec.slice(0, -3) : spec;
  const tsPath = path.resolve(baseDir, `${stripped}.ts`);
  if (fs.existsSync(tsPath)) return tsPath;
  const indexPath = path.resolve(baseDir, stripped, 'index.ts');
  if (fs.existsSync(indexPath)) return indexPath;
  return UNRESOLVED;
}

/**
 * Builds the importer-count map for every production file.
 * @param prodFiles - All discovered production source paths.
 * @param prodSet - Same paths as a set for O(1) membership checks.
 * @returns Map from absolute file path to its importer count.
 */
function countImporters(
  prodFiles: readonly string[],
  prodSet: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of prodFiles) counts.set(f, 0);
  for (const file of prodFiles) {
    for (const spec of parseImports(file)) {
      const resolved = resolveImport(file, spec);
      if (resolved === UNRESOLVED || resolved === file || !prodSet.has(resolved)) continue;
      counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Collects Pipeline files with zero importers (excluding entry points).
 * @param counts - Importer count map produced by {@link countImporters}.
 * @returns Repo-relative dead-file paths.
 */
function collectDeadFiles(counts: ReadonlyMap<string, number>): readonly string[] {
  const dead: string[] = [];
  for (const [file, count] of counts) {
    if (!file.startsWith(PIPELINE_ROOT)) continue;
    if (ENTRY_POINTS.has(file)) continue;
    if (count > 0) continue;
    const relative = path.relative(REPO_ROOT, file);
    dead.push(relative);
  }
  return dead;
}

/** Sentinel returned by side-effecting helpers (parity with {@link walk}). */
type Done = true;

/**
 * Reports the dead-file set and exits non-zero. Extracted so the main
 * driver stays under the cognitive-complexity ceiling.
 * @param dead - Repo-relative paths flagged as dead.
 * @returns Sentinel that is never reached because the helper exits.
 */
function reportDeadAndExit(dead: readonly string[]): Done {
  console.error('❌ DEAD CODE — files with zero production importers:');
  const sorted = [...dead].sort((a, b): number => a.localeCompare(b));
  for (const file of sorted) console.error(`   ${file}`);
  console.error('');
  console.error('   Each file listed above is reachable only from tests (or');
  console.error('   nothing). Delete it, or add it to ENTRY_POINTS in');
  console.error('   src/Tests/Tools/detect-dead-code.ts with a justifying');
  console.error('   comment if it is a public surface.');
  process.exit(1);
}

/**
 * Drives the canary end-to-end. Wrapped in a guarded entry point so the
 * file can also be imported (e.g. by colocated unit tests) without
 * triggering a filesystem walk or `process.exit(1)`.
 * @returns Sentinel `true` once the canary completes successfully.
 */
function runDeadCodeCanary(): Done {
  const prodFiles: string[] = [];
  walk(SRC_ROOT, prodFiles);
  const counts = countImporters(prodFiles, new Set(prodFiles));
  const dead = collectDeadFiles(counts);
  if (dead.length > 0) return reportDeadAndExit(dead);
  const scanned = prodFiles.filter((f): boolean => f.startsWith(PIPELINE_ROOT)).length;
  console.log(`✅ Dead-code canary clean — ${String(scanned)} Pipeline files all have ≥1 importer`);
  return true;
}

/**
 * Detects whether this module is the process entry point. Used so the
 * canary side effects fire only under direct `tsx` invocation, leaving
 * test imports side-effect-free. Matches by absolute path AND filename
 * suffix to tolerate the `.ts` ↔ compiled-loader path mismatch tsx
 * exposes on Windows.
 * @returns True when invoked as the main module.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).endsWith('detect-dead-code.ts');
}

/**
 * Entry-point wrapper around {@link runDeadCodeCanary} — discards the
 * sentinel via a typed binding so the call-site stays clear of the
 * no-void / naming-convention rules. The runner exits the process on
 * failure, so `didComplete` is always `true` on return.
 * @returns The sentinel emitted by the runner.
 */
function bootDeadCodeCanary(): Done {
  const didComplete = runDeadCodeCanary();
  return didComplete;
}

if (isMainModule()) bootDeadCodeCanary();
