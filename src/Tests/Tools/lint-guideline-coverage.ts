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
 * Mechanism: drives ESLint's own flat-config resolver against a
 * representative file in each cluster, then asserts that the
 * RESOLVED rule severity + options match the expected canonical
 * settings (sourced from CLEAN_CODE.md).
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
];

/**
 * Pull the `max` numeric option out of an ESLint rule entry. Supports
 * both shorthand `['error', 10]` and structured `['error', { max: 10 }]`.
 * Returns -1 when no inspectable max is present (caller treats as "no cap").
 * @param value - Raw rule entry (severity or [severity, ...options]).
 * @returns The numeric cap, or -1 when not inspectable.
 */
function extractRuleMax(value: unknown): number {
  const valueArr: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (valueArr.length < 2) return -1;
  const opts: unknown = valueArr[1];
  if (typeof opts === 'number') return opts;
  if (typeof opts === 'object' && opts !== null && 'max' in opts) {
    const maxVal = opts.max;
    return typeof maxVal === 'number' ? maxVal : -1;
  }
  return -1;
}

/**
 * Whether a rule entry is disabled (severity `'off'` or `0`).
 * @param value - Raw rule entry.
 * @returns True when ESLint would treat the rule as turned off.
 */
function isRuleOff(value: unknown): boolean {
  if (value === 'off' || value === 0) return true;
  if (Array.isArray(value) && (value[0] === 'off' || value[0] === 0)) return true;
  return false;
}

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
 * Resolve the effective rule set ESLint would apply to one file.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param file - Repo-relative path to a representative file.
 * @returns Resolved rule map (empty object when none configured).
 */
async function resolveRulesForFile(eslint: ESLint, file: string): Promise<Record<string, unknown>> {
  const cfg = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
  return cfg.rules ?? {};
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
 * Phase 8.5c / C5 — surfaces the drained-vs-pending split required by
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
 * Format and emit the audit report to stdout / stderr.
 * @param failures - All accumulated failure records.
 * @returns Process exit code (0 = success, 1 = at least one failure).
 */
function printReport(failures: readonly ICoverageFailure[]): number {
  if (failures.length === 0) {
    const clusterCount = String(PIPELINE_CLUSTERS.length);
    process.stdout.write(
      `✅ Guideline coverage: ${clusterCount} clusters all enforce CLEAN_CODE.md caps\n`,
    );
    return 0;
  }
  process.stderr.write('\n❌ GUIDELINE COVERAGE FAILURES\n');
  process.stderr.write('═══════════════════════════════════════════════════════\n\n');
  for (const f of failures) {
    process.stderr.write(`Cluster: ${f.cluster}\n`);
    process.stderr.write(`  File:   ${f.file}\n`);
    process.stderr.write(`  Issue:  ${f.reason}\n\n`);
  }
  process.stderr.write('Fix: update eslint.config.mjs so the cluster block includes the rule.\n');
  process.stderr.write('See CLEAN_CODE.md for the canonical caps.\n');
  return 1;
}

const ESLINT_RUNNER = new ESLint();
const AUDIT_PROMISES = PIPELINE_CLUSTERS.map((cluster): Promise<readonly ICoverageFailure[]> =>
  auditCluster(ESLINT_RUNNER, cluster),
);
const CLUSTER_FAILURES = await Promise.all(AUDIT_PROMISES);
const ALL_FAILURES: readonly ICoverageFailure[] = CLUSTER_FAILURES.flat();
const STATUS_ROWS: readonly IClusterStatusRow[] = PIPELINE_CLUSTERS.map(buildStatusRow);
const PRINTED_ROW_COUNT = printStatusTable(STATUS_ROWS);
process.stdout.write(`(reported ${String(PRINTED_ROW_COUNT)} cluster status rows)\n`);
const EXIT_CODE = printReport(ALL_FAILURES);
process.exit(EXIT_CODE);
