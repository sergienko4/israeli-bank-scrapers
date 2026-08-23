/**
 * COVERAGE REPORT — rendering for the guideline-coverage gate.
 *
 * <p>Holds every writer the gate uses: the always-emitted cluster status table,
 * the success summary, and the failure report. Separating rendering from the
 * audit keeps the entrypoint about WHAT was checked rather than how it prints.
 */

/** Per-failure record emitted when a resolved config violates an expectation. */
export interface ICoverageFailure {
  readonly cluster: string;
  readonly file: string;
  readonly ruleId: string;
  readonly reason: string;
}

/** Per-cluster status row emitted by the report (always shown, never blocks). */
export interface IClusterStatusRow {
  readonly cluster: string;
  readonly file: string;
  readonly status: 'enforced' | 'partial';
  readonly deferred: readonly string[];
}

/**
 * Render a status cell, naming any rules the cluster still defers.
 * @param row - Status row being rendered.
 * @returns Cell text for the Status column.
 */
function statusCell(row: IClusterStatusRow): string {
  if (row.deferred.length === 0) return row.status;
  const names = row.deferred.join(', ');
  return `${row.status} — ${names} deferred`;
}

/**
 * Render the cluster-state markdown table (always emitted to stdout).
 * Phase 8.5c / C5 — surfaces the enforced-vs-partial split required by
 * `sub-c-pii-types-docs/implementation.txt:100` (renderClusterTable).
 * @param rows - One status row per cluster.
 * @returns The number of rows rendered (matches `rows.length`).
 */
export function printStatusTable(rows: readonly IClusterStatusRow[]): number {
  process.stdout.write('\n| Cluster | Representative file | Status |\n');
  process.stdout.write('|---------|---------------------|--------|\n');
  for (const r of rows) {
    const cell = statusCell(r);
    process.stdout.write(`| ${r.cluster} | ${r.file} | ${cell} |\n`);
  }
  process.stdout.write('\n');
  return rows.length;
}

/**
 * Summarise the cluster status line, accounting for deferrals.
 * @param rows - Per-cluster status rows.
 * @returns The formatted cluster summary line.
 */
function clusterSummary(rows: readonly IClusterStatusRow[]): string {
  const partial = rows.filter(r => r.deferred.length > 0);
  const enforced = String(rows.length - partial.length);
  const total = String(rows.length);
  const suffix = partial.length === 0 ? '' : `, ${String(partial.length)} partial`;
  return `✅ Guideline coverage: ${enforced}/${total} clusters enforce every cap${suffix}\n`;
}

/**
 * Emit the success summary, counting clusters that defer a rule.
 *
 * The table printed just above can carry `partial` rows, so a blanket "all
 * clusters enforce every cap" line would contradict it on the same screen and
 * hide the deferrals a reader is meant to act on.
 * @param rows - Per-cluster status rows.
 * @param fileCount - Production files checked by the cap-regime audit.
 * @returns Exit code 0.
 */
function printSuccess(rows: readonly IClusterStatusRow[], fileCount: number): number {
  const summary = clusterSummary(rows);
  process.stdout.write(summary);
  process.stdout.write(
    `✅ Cap regimes: ${String(fileCount)} production files match the cap table exactly\n`,
  );
  return 0;
}

/**
 * Emit the remediation guidance that follows a failure list.
 * @returns Exit code 1, so callers can return it directly.
 */
function printFixHint(): number {
  process.stderr.write('Fix: update eslint.config.mjs so the cluster block includes the rule.\n');
  process.stderr.write('A cap-regime failure means eslint.config.mjs and the cap table\n');
  process.stderr.write('(CapRegimeTable.ts + CapOverrides.ts) disagree — restore the\n');
  process.stderr.write('deleted block, or update the table if the tree was deliberately\n');
  process.stderr.write('drained (eslint-rules-guidlines.md §1).\n');
  process.stderr.write('See CLEAN_CODE.md for the canonical caps.\n');
  return 1;
}

/**
 * Emit one failure record.
 * @param failure - The record to print.
 * @returns The rule id printed, so callers can chain.
 */
function printFailure(failure: ICoverageFailure): string {
  process.stderr.write(`Cluster: ${failure.cluster}\n`);
  process.stderr.write(`  File:   ${failure.file}\n`);
  process.stderr.write(`  Rule:   ${failure.ruleId}\n`);
  process.stderr.write(`  Issue:  ${failure.reason}\n\n`);
  return failure.ruleId;
}

/**
 * Emit the failure-report header banner.
 * @returns The number of header lines written.
 */
function printFailureHeader(): number {
  process.stderr.write('\n❌ GUIDELINE COVERAGE FAILURES\n');
  process.stderr.write('═══════════════════════════════════════════════════════\n\n');
  return 2;
}

/**
 * Format and emit the audit report to stdout / stderr.
 * @param failures - All accumulated failure records.
 * @param rows - Per-cluster status rows, used for the enforced/partial split.
 * @param fileCount - Production files checked by the cap-regime audit.
 * @returns Process exit code (0 = success, 1 = at least one failure).
 */
export function printReport(
  failures: readonly ICoverageFailure[],
  rows: readonly IClusterStatusRow[],
  fileCount: number,
): number {
  if (failures.length === 0) return printSuccess(rows, fileCount);
  printFailureHeader();
  for (const f of failures) printFailure(f);
  return printFixHint();
}
