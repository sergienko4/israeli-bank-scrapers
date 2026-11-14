/**
 * DEAD-CODE GATE — symbol-level reachability from the public entry points.
 *
 * Files with zero production importers are only the first symptom. A barrel
 * can re-export a file that no consumer ever imports by name, so this gate
 * resolves named, namespace and `export *` edges and reports both unreachable
 * files and unused local exports.
 *
 * The committed baseline freezes today's dead items. New items fail; fixing
 * items shrinks the baseline. Update it only after a deliberate burn-down:
 * `npm run lint:dead-code -- --update-baseline`.
 *
 * Invoked via `npm run lint:dead-code`; the CI Static checks job owns it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { IDeadCodeBaseline, IDeadCodeReport } from './DeadCodeReachability.js';
import { findRegressions, scanDeadCode } from './DeadCodeReachability.js';

const REPO_ROOT = process.cwd();
const BASELINE_PATH = path.join(REPO_ROOT, 'src', 'Tests', 'Tools', 'dead-code.baseline.json');
const UPDATE_FLAG = '--update-baseline';

/** Public surfaces. Each entry needs a reason; a file alone is not enough. */
const ENTRY_POINTS: readonly string[] = [
  // Package entry: every public export starts here.
  'src/index.ts',
  // DNS warm-up manifest: its bash consumer runs before npm install.
  'src/Scrapers/Pipeline/Registry/Config/PipelineBankHosts.ts',
];

/** Sentinel returned by side-effecting helpers (no-void rule). */
type Done = true;

/** Empty baseline used when the committed file does not exist yet. */
const EMPTY_BASELINE: IDeadCodeBaseline = {
  note: 'No baseline yet.',
  unreachableFiles: [],
  unusedExports: [],
};

/**
 * Read the committed baseline.
 * @returns Parsed baseline, or the empty baseline when absent.
 */
function readBaseline(): IDeadCodeBaseline {
  if (!fs.existsSync(BASELINE_PATH)) return EMPTY_BASELINE;
  const text = fs.readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(text) as IDeadCodeBaseline;
}

/**
 * Write the current dead items as the new baseline.
 * @param report - Current dead items.
 * @returns True once written.
 */
function writeBaseline(report: IDeadCodeReport): Done {
  const baseline: IDeadCodeBaseline = {
    note: 'Frozen symbol-level dead code. New items fail; remove items only as they are deleted. Refresh with `npm run lint:dead-code -- --update-baseline` after a deliberate burn-down.',
    unreachableFiles: report.files,
    unusedExports: report.exports,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `✅ Dead-code baseline written — ${String(report.files.length)} unreachable files, ${String(report.exports.length)} unused exports`,
  );
  return true;
}

/**
 * Print one labelled list.
 * @param label - Section heading.
 * @param items - Items to print.
 * @returns True once printed.
 */
function printItems(label: string, items: readonly string[]): Done {
  if (items.length === 0) return true;
  console.error(`${label}:`);
  for (const item of items) console.error(`   ${item}`);
  return true;
}

/**
 * Report new dead items and exit non-zero.
 * @param regressions - Items absent from the baseline.
 * @returns Sentinel that is never reached because the helper exits.
 */
function reportRegressionsAndExit(regressions: IDeadCodeReport): Done {
  console.error('❌ DEAD CODE — new items outside the frozen baseline:');
  printItems('   Unreachable files', regressions.files);
  printItems('   Unused exports', regressions.exports);
  console.error('');
  console.error('   Delete the dead code, or refresh the baseline after a');
  console.error('   deliberate burn-down with:');
  console.error('   npm run lint:dead-code -- --update-baseline');
  process.exit(1);
}

/**
 * Refuse to grow the committed baseline.
 * @param report - Current dead items.
 * @param baseline - Previous baseline.
 * @returns True when the current report only shrinks the baseline.
 */
function canReplaceBaseline(report: IDeadCodeReport, baseline: IDeadCodeBaseline): boolean {
  const regressions = findRegressions(report, baseline);
  return regressions.files.length === 0 && regressions.exports.length === 0;
}

/**
 * Run the gate over the repository.
 * @returns Sentinel `true` once the gate completes successfully.
 */
function runDeadCodeGate(): Done {
  const report = scanDeadCode(REPO_ROOT, ENTRY_POINTS);
  const baseline = readBaseline();
  const hasBaseline = fs.existsSync(BASELINE_PATH);
  if (process.argv.includes(UPDATE_FLAG)) {
    if (!hasBaseline || canReplaceBaseline(report, baseline)) return writeBaseline(report);
    const regressions = findRegressions(report, baseline);
    console.error('❌ Baseline may only shrink: new dead items appeared.');
    printItems('   Unreachable files', regressions.files);
    printItems('   Unused exports', regressions.exports);
    process.exit(1);
  }
  const regressions = findRegressions(report, baseline);
  if (regressions.files.length > 0 || regressions.exports.length > 0) {
    return reportRegressionsAndExit(regressions);
  }
  console.log(
    `✅ Dead-code gate clean — ${String(report.files.length)} frozen files, ${String(report.exports.length)} frozen exports`,
  );
  return true;
}

/**
 * Detect whether this module is the process entry point.
 * @returns True when invoked as the main module.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).endsWith('detect-dead-code.ts');
}

/**
 * Entry-point wrapper around {@link runDeadCodeGate}.
 * @returns The sentinel emitted by the runner.
 */
function bootDeadCodeGate(): Done {
  const didComplete = runDeadCodeGate();
  return didComplete;
}

if (isMainModule()) bootDeadCodeGate();
