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
 * Two kinds of entries live here:
 *   1. Legitimate entry points — public surfaces consumed externally
 *      (the npm package barrel) or via path-walk tooling (architecture
 *      linter fixtures).
 *   2. Tech-debt parking — orphaned files surfaced by the very first
 *      canary run. Each is a candidate for deletion; a follow-up commit
 *      prunes each one. Remove entries here AS the corresponding files
 *      are deleted.
 */
const ENTRY_POINTS: ReadonlySet<string> = new Set([
  // (1) Public barrel export — consumed via the npm package's entry.
  path.join(PIPELINE_ROOT, 'index.ts'),
  // (1) Architecture-linter fixture — loaded by file path, not import.
  path.join(PIPELINE_ROOT, 'EslintCanaries', 'Rule10Violation.ts'),
  // (2) tech-debt: orphaned at canary introduction; delete in follow-up
  path.join(PIPELINE_ROOT, 'Banks', 'OneZero', 'OneZeroCreds.ts'),
  path.join(PIPELINE_ROOT, 'Core', 'Builder', 'LoginPhaseFactory.ts'),
  path.join(PIPELINE_ROOT, 'Interceptors', 'PopupGuard.ts'),
  path.join(PIPELINE_ROOT, 'Mediator', 'Api', 'ApiOtpRetriever.ts'),
  path.join(PIPELINE_ROOT, 'Mediator', 'Api', 'TokenLoginOrchestrator.ts'),
  path.join(PIPELINE_ROOT, 'Mediator', 'Home', 'HomeProbe.ts'),
  path.join(PIPELINE_ROOT, 'Mediator', 'Selector', 'ScopedFieldResolver.ts'),
  path.join(PIPELINE_ROOT, 'Mediator', 'Timing', 'PollWithBudget.ts'),
  path.join(PIPELINE_ROOT, 'Registry', 'WK', 'index.ts'),
  path.join(PIPELINE_ROOT, 'Strategy', 'Scrape', 'Monthly', 'MonthlyScrapeFactory.ts'),
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

const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;

/**
 * Parse `from '...'` and `import '...'` specifiers from one file.
 * @param file - Absolute file path.
 * @returns Raw specifiers (relative or external).
 */
function parseImports(file: string): readonly string[] {
  const src = fs.readFileSync(file, 'utf8');
  const matches = [...src.matchAll(IMPORT_RE)];
  return matches.map((m): string => m[1]);
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

const PROD_FILES: string[] = [];
walk(SRC_ROOT, PROD_FILES);
const PROD_SET = new Set(PROD_FILES);

const IMPORTER_COUNT = new Map<string, number>();
for (const f of PROD_FILES) IMPORTER_COUNT.set(f, 0);

for (const file of PROD_FILES) {
  for (const spec of parseImports(file)) {
    const resolved = resolveImport(file, spec);
    if (resolved === UNRESOLVED) continue;
    if (resolved === file) continue;
    if (!PROD_SET.has(resolved)) continue;
    IMPORTER_COUNT.set(resolved, (IMPORTER_COUNT.get(resolved) ?? 0) + 1);
  }
}

const DEAD: string[] = [];
for (const [file, count] of IMPORTER_COUNT) {
  if (!file.startsWith(PIPELINE_ROOT)) continue;
  if (ENTRY_POINTS.has(file)) continue;
  if (count > 0) continue;
  const relative = path.relative(REPO_ROOT, file);
  DEAD.push(relative);
}

if (DEAD.length > 0) {
  console.error('❌ DEAD CODE — files with zero production importers:');
  const sorted = [...DEAD].sort((a, b): number => a.localeCompare(b));
  for (const file of sorted) console.error(`   ${file}`);
  console.error('');
  console.error('   Each file listed above is reachable only from tests (or');
  console.error('   nothing). Delete it, or add it to ENTRY_POINTS in');
  console.error('   src/Tests/Tools/detect-dead-code.ts with a justifying');
  console.error('   comment if it is a public surface.');
  process.exit(1);
}

const PIPELINE_FILES = PROD_FILES.filter((f): boolean => f.startsWith(PIPELINE_ROOT));
const SCANNED = PIPELINE_FILES.length;
console.log(`✅ Dead-code canary clean — ${String(SCANNED)} Pipeline files all have ≥1 importer`);
