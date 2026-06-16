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

import * as path from 'node:path';

import { parseImports, resolveImport, UNRESOLVED, walkProdFiles } from './ImportGraphScan.js';

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
]);

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

/** Sentinel returned by side-effecting helpers (parity with {@link walkProdFiles}). */
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
  walkProdFiles(SRC_ROOT, prodFiles);
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
