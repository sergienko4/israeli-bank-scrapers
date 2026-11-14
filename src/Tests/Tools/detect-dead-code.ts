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
const GUARD_FLAG = '--guard-against';

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
 * Read a baseline file.
 * @param file - Baseline JSON path.
 * @returns Parsed baseline, or the empty baseline when absent.
 */
function loadBaselineFrom(file: string): IDeadCodeBaseline {
  if (!fs.existsSync(file)) return EMPTY_BASELINE;
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text) as IDeadCodeBaseline;
}

/**
 * Read the committed baseline.
 * @returns Parsed baseline, or the empty baseline when absent.
 */
function readBaseline(): IDeadCodeBaseline {
  return loadBaselineFrom(BASELINE_PATH);
}

/**
 * Read the `--guard-against <path>` flag value.
 * @returns The base baseline path, or '' when absent.
 */
function readGuardPath(): string {
  const flagAt = process.argv.indexOf(GUARD_FLAG);
  if (flagAt < 0) return '';
  return process.argv[flagAt + 1] ?? '';
}

/**
 * Whether the tamper-guard flag was supplied.
 * @returns True when `--guard-against` is present.
 */
function hasGuardFlag(): boolean {
  return process.argv.includes(GUARD_FLAG);
}

/**
 * Convert a stored baseline into the report shape used by the ratchet.
 * @param baseline - Stored baseline.
 * @returns Report with the same items.
 */
function reportOfBaseline(baseline: IDeadCodeBaseline): IDeadCodeReport {
  return { files: baseline.unreachableFiles, exports: baseline.unusedExports };
}

/**
 * Report a missing guard path and exit non-zero.
 * @returns Sentinel that is never reached because the helper exits.
 */
function reportMissingGuardPath(): Done {
  console.error(`❌ ${GUARD_FLAG} requires a base baseline file path.`);
  process.exit(1);
}

/**
 * Report a baseline that widened versus the base branch and exit non-zero.
 * @param widened - Baseline items new relative to the base.
 * @returns Sentinel that is never reached because the helper exits.
 */
function reportWidening(widened: IDeadCodeReport): Done {
  console.error('❌ DEAD CODE — committed baseline WIDENED vs. the base branch:');
  printItems('   New frozen files', widened.files);
  printItems('   New frozen exports', widened.exports);
  console.error('');
  console.error('   The baseline may only shrink. Delete the dead code instead of');
  console.error('   freezing it in the same PR.');
  process.exit(1);
}

/**
 * Compare the PR baseline with the PR base branch baseline.
 * @param prBaseline - Baseline committed on this branch.
 * @param baseBaseline - Baseline on the PR's target branch.
 * @returns True when the baseline did not widen.
 */
function evaluateGuard(prBaseline: IDeadCodeBaseline, baseBaseline: IDeadCodeBaseline): Done {
  const prReport = reportOfBaseline(prBaseline);
  const widened = findRegressions(prReport, baseBaseline);
  if (widened.files.length > 0 || widened.exports.length > 0) return reportWidening(widened);
  console.log(
    `✅ Dead-code baseline tamper-guard clean — ${String(prBaseline.unreachableFiles.length)} files, ${String(prBaseline.unusedExports.length)} exports frozen`,
  );
  return true;
}

/**
 * Run the tamper-guard against a base-branch baseline.
 * @param basePath - Path to the base branch's baseline JSON.
 * @returns Sentinel once the guard accepts the baseline.
 */
function runGuard(basePath: string): Done {
  if (basePath === '') return reportMissingGuardPath();
  const prBaseline = readBaseline();
  const baseBaseline = loadBaselineFrom(basePath);
  return evaluateGuard(prBaseline, baseBaseline);
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
  if (hasGuardFlag()) {
    const guardPath = readGuardPath();
    return runGuard(guardPath);
  }
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
