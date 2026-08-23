/**
 * LINT GUIDELINE COVERAGE GATE — entrypoint.
 *
 * Asserts that `eslint.config.mjs` actually enforces the
 * CLEAN_CODE.md "Code Quality" caps for every Pipeline cluster we
 * ship. The gate exists because CR cycle-1 (PR #278) caught a
 * per-function size bloat (`redactUrl`, 10-12 LoC) that should have
 * been blocked at pre-commit — but the §13 PiiRedactor block had
 * NO `max-lines-per-function` rule, and the §6C default cap was 15
 * (so 12 LoC slipped through). The doc/config mismatch was the
 * root cause; this gate makes any future mismatch a hard failure.
 *
 * Mechanism: drives ESLint's own flat-config resolver, then asserts
 * the RESOLVED rule severity + options against expectations held
 * outside the config. Two complementary checks run:
 *
 *   1. CLUSTER SAMPLE — a named, documented cluster must hold at
 *      least the canonical caps (upper-bound check).
 *   2. CAP REGIME AUDIT — EVERY production directory must resolve
 *      each cap to EXACTLY the value `CapRegimeTable.ts` predicts.
 *      This is what catches a deleted grandfather-then-tighten block:
 *      flat config is last-wins, so removing a block that pins a
 *      drained sub-tree back to canonical silently RELAXES shipped
 *      code. Sampling cannot see that; a complete check can.
 *
 * Called by:
 *   - `npm run lint:guideline-coverage`
 *   - the pre-commit hook (Gate 10)
 *
 * Exit codes:
 *   - 0 = every cluster has the expected rules
 *   - 1 = at least one cluster is missing a rule or has it weakened
 */

import { ESLint } from 'eslint';

import {
  auditCapRegimes,
  extractRuleMax,
  isRuleOff,
  resolveRulesForFile,
} from './EslintCapProbe.js';

/** Expected rule settings per Pipeline cluster (sourced from CLEAN_CODE.md). */
interface IClusterExpectations {
  readonly clusterName: string;
  readonly representativeFile: string;
  readonly expectations: readonly IRuleExpectation[];
  /**
   * Rules this cluster does not yet satisfy, named individually.
   *
   * Deferring a whole cluster surrenders every OTHER rule in it: a cluster
   * held back for one un-drained cap stops being checked for file size,
   * complexity and parameter count too, so a scoped declaration can be
   * deleted there unnoticed. Naming the exception keeps the rest enforced.
   * Source-of-truth for a deferral is the per-section "STATUS" column of
   * the CLEAN_CODE.md per-cluster table.
   */
  readonly deferredRules?: readonly string[];
}

/** A single per-rule cap that must hold for the cluster's resolved config. */
interface IRuleExpectation {
  readonly ruleId: string;
  readonly maxAllowed: number;
}

/** Per-failure record emitted when a cluster's resolved config violates an expectation. */
interface ICoverageFailure {
  readonly cluster: string;
  readonly file: string;
  readonly ruleId: string;
  readonly reason: string;
}

/** Per-cluster status row emitted by the report (always shown, never blocks). */
interface IClusterStatusRow {
  readonly cluster: string;
  readonly file: string;
  readonly status: 'enforced' | 'partial';
  readonly deferred: readonly string[];
}

/** Sentinel for "no failure" — production code bans null/undefined returns. */
const NO_FAILURE = '' as const;
type FailureReason = string;

/**
 * Canonical caps from CLEAN_CODE.md (the single source of truth).
 *   • Every drained cluster (§11/§12/§12B/§13/§14) holds the
 *     canonical ≤10 LoC per function HARD CAP (post Phase 8.5a/b/c).
 *   • §3 Main Source Strict still resolves `max-lines` to 300, so that
 *     ONE rule is deferred by name; its other three caps are enforced.
 *   • §6 Pipeline Logic already resolves every cap it declares, so it
 *     is enforced outright. That is what makes deleting a per-cluster
 *     declaration fail this gate rather than pass unnoticed.
 *   • §19.1a/b/c are drained sub-trees of `Strategy/**`, which §19.1
 *     grandfathers to 40 LoC per function. Each is pinned back to the
 *     canonical 10 by a LATER block; deleting that block silently relaxes
 *     shipped code from 10 to 40. The CAP REGIME AUDIT is what turns that
 *     into a gate failure, and it does so for every such block rather than
 *     only the few named here. §19.1c pins only `max-lines`, so its
 *     per-function cap is deferred by name rather than pretended.
 * Per-cluster overrides are allowed to be STRICTER but never laxer.
 */
const PIPELINE_CLUSTERS: readonly IClusterExpectations[] = [
  {
    clusterName: 'Main Source Strict (§3)',
    representativeFile: 'src/index.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 20 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
    deferredRules: ['max-lines'],
  },
  {
    clusterName: 'Pipeline Logic (§6)',
    representativeFile: 'src/Scrapers/Pipeline/Phases/AccountResolve/AccountResolvePhase.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 15 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'PiiRedactor (§13)',
    representativeFile: 'src/Scrapers/Pipeline/Types/PiiRedactor/Account.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Network (§11)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Network/Scoring/Scoring.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Scrape (§12)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeRouter.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 20 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Scrape canonical-10 sub-folders (§12B)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/PhaseActions.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'ApiDirectCall ConfigContracts (§14)',
    representativeFile:
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/TemplateTypes.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape Executor (§19.1a)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor/Account.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape ScrapeData (§19.1b)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData/ScrapeDataAssembly.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape Account (§19.1c)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeFirstWave.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
    deferredRules: ['max-lines-per-function'],
  },
];

/**
 * Check ONE expectation against the cluster's resolved rule set.
 * @param resolved - Rules object from `ESLint.calculateConfigForFile`.
 * @param expectation - The rule + cap to enforce.
 * @returns Empty string when expectation holds, else a failure reason.
 */
function checkExpectation(
  resolved: Record<string, unknown>,
  expectation: IRuleExpectation,
): FailureReason {
  const ruleValue = resolved[expectation.ruleId];
  if (ruleValue === undefined) return `rule '${expectation.ruleId}' is NOT configured`;
  if (isRuleOff(ruleValue)) return `rule '${expectation.ruleId}' is OFF`;
  const actualMax = extractRuleMax(ruleValue);
  if (actualMax < 0) return `rule '${expectation.ruleId}' has no inspectable max option`;
  if (actualMax > expectation.maxAllowed) {
    return `rule '${expectation.ruleId}' max=${String(actualMax)} > canonical ${String(expectation.maxAllowed)}`;
  }
  return NO_FAILURE;
}

/**
 * Audit ONE expectation against a cluster's resolved config.
 * @param resolved - Effective rules for the cluster's representative file.
 * @param cluster - Cluster the expectation belongs to.
 * @param expectation - Single rule cap being checked.
 * @returns One failure record, or nothing when the cap holds.
 */
function failuresFor(
  resolved: Record<string, unknown>,
  cluster: IClusterExpectations,
  expectation: IRuleExpectation,
): readonly ICoverageFailure[] {
  const reason = checkExpectation(resolved, expectation);
  if (reason === NO_FAILURE) return [];
  const failure: ICoverageFailure = {
    cluster: cluster.clusterName,
    file: cluster.representativeFile,
    ruleId: expectation.ruleId,
    reason,
  };
  return [failure];
}

/**
 * Audit ONE Pipeline cluster against its expectation list.
 *
 * Only the rules named in `deferredRules` are skipped. Every other cap in
 * the cluster is enforced, so removing a scoped declaration lowers the
 * resolved cap and fails here.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param cluster - Cluster definition (name + representative file + caps).
 * @returns Failure records (empty when all enforced expectations hold).
 */
async function auditCluster(
  eslint: ESLint,
  cluster: IClusterExpectations,
): Promise<readonly ICoverageFailure[]> {
  const resolved = await resolveRulesForFile(eslint, cluster.representativeFile);
  const deferred = cluster.deferredRules ?? [];
  return cluster.expectations.flatMap((expectation): readonly ICoverageFailure[] => {
    const isDeferred = deferred.includes(expectation.ruleId);
    if (isDeferred) return [];
    return failuresFor(resolved, cluster, expectation);
  });
}

/**
 * Build the per-cluster status row reported in the markdown table.
 * @param cluster - Cluster definition.
 * @returns Single status row with cluster name + representative file + state.
 */
function buildStatusRow(cluster: IClusterExpectations): IClusterStatusRow {
  const deferred = cluster.deferredRules ?? [];
  const status: IClusterStatusRow['status'] = deferred.length === 0 ? 'enforced' : 'partial';
  return {
    cluster: cluster.clusterName,
    file: cluster.representativeFile,
    status,
    deferred,
  };
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
function printStatusTable(rows: readonly IClusterStatusRow[]): number {
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
 * Emit the success summary, counting clusters that defer a rule.
 *
 * The table printed just above can carry `partial` rows, so a blanket "all
 * clusters enforce every cap" line would contradict it on the same screen and
 * hide the deferrals a reader is meant to act on.
 * @param rows - Per-cluster status rows.
 * @param dirCount - Production directories checked by the cap-regime audit.
 * @returns Exit code 0.
 */
function printSuccess(rows: readonly IClusterStatusRow[], dirCount: number): number {
  const partial = rows.filter(r => r.deferred.length > 0);
  const enforced = String(rows.length - partial.length);
  const total = String(rows.length);
  const partialCount = String(partial.length);
  const suffix = partial.length === 0 ? '' : `, ${partialCount} partial`;
  process.stdout.write(
    `✅ Guideline coverage: ${enforced}/${total} clusters enforce every cap${suffix}\n`,
  );
  process.stdout.write(
    `✅ Cap regimes: ${String(dirCount)} production directories match the cap table exactly\n`,
  );
  return 0;
}

/**
 * Format and emit the audit report to stdout / stderr.
 * @param failures - All accumulated failure records.
 * @param rows - Per-cluster status rows, used for the enforced/partial split.
 * @param dirCount - Production directories checked by the cap-regime audit.
 * @returns Process exit code (0 = success, 1 = at least one failure).
 */
function printReport(
  failures: readonly ICoverageFailure[],
  rows: readonly IClusterStatusRow[],
  dirCount: number,
): number {
  if (failures.length === 0) return printSuccess(rows, dirCount);
  process.stderr.write('\n❌ GUIDELINE COVERAGE FAILURES\n');
  process.stderr.write('═══════════════════════════════════════════════════════\n\n');
  for (const f of failures) {
    process.stderr.write(`Cluster: ${f.cluster}\n`);
    process.stderr.write(`  File:   ${f.file}\n`);
    process.stderr.write(`  Rule:   ${f.ruleId}\n`);
    process.stderr.write(`  Issue:  ${f.reason}\n\n`);
  }
  process.stderr.write('Fix: update eslint.config.mjs so the cluster block includes the rule.\n');
  process.stderr.write('A cap-regime failure means eslint.config.mjs and CapRegimeTable.ts\n');
  process.stderr.write('disagree — restore the deleted block, or update the table if the\n');
  process.stderr.write('tree was deliberately drained (eslint-rules-guidlines.md §1).\n');
  process.stderr.write('See CLEAN_CODE.md for the canonical caps.\n');
  return 1;
}

const ESLINT_RUNNER = new ESLint();
const REGIME_RESULT = await auditCapRegimes(ESLINT_RUNNER);
const REGIME_FAILURES: readonly ICoverageFailure[] = REGIME_RESULT.failures.map(
  (f): ICoverageFailure => ({
    cluster: `cap regime: ${f.dir}`,
    file: f.file,
    ruleId: f.ruleId,
    reason: f.reason,
  }),
);
const AUDIT_PROMISES = PIPELINE_CLUSTERS.map((cluster): Promise<readonly ICoverageFailure[]> =>
  auditCluster(ESLINT_RUNNER, cluster),
);
const CLUSTER_FAILURES = await Promise.all(AUDIT_PROMISES);
const ALL_FAILURES: readonly ICoverageFailure[] = [...CLUSTER_FAILURES.flat(), ...REGIME_FAILURES];
const STATUS_ROWS: readonly IClusterStatusRow[] = PIPELINE_CLUSTERS.map(buildStatusRow);
const PRINTED_ROW_COUNT = printStatusTable(STATUS_ROWS);
process.stdout.write(`(reported ${String(PRINTED_ROW_COUNT)} cluster status rows)\n`);
const EXIT_CODE = printReport(ALL_FAILURES, STATUS_ROWS, REGIME_RESULT.dirCount);
process.exit(EXIT_CODE);
