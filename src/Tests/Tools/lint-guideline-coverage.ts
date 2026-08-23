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
 *      least the canonical caps (upper-bound check). Clusters live
 *      in `GuidelineClusters.ts`.
 *   2. CAP REGIME AUDIT — EVERY production FILE must resolve each
 *      cap to EXACTLY the value the cap table predicts, from the
 *      canonical caps in `CapRegimeTable.ts` and the deliberate
 *      deviations in `CapOverrides.ts`.
 *      This is what catches a deleted grandfather-then-tighten block:
 *      flat config is last-wins, so removing a block that pins a
 *      drained sub-tree back to canonical silently RELAXES shipped
 *      code. Sampling cannot see that; a complete check can. Files
 *      are the unit because several blocks scope a cap to a single
 *      filename beside a differently-capped directory.
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

import { extractRuleMax, isRuleOff, resolveRulesForFile } from './CapResolution.js';
import {
  type IClusterStatusRow,
  type ICoverageFailure,
  printReport,
  printStatusTable,
} from './CoverageReport.js';
import { auditCapRegimes } from './EslintCapProbe.js';
import {
  type IClusterExpectations,
  type IRuleExpectation,
  PIPELINE_CLUSTERS,
} from './GuidelineClusters.js';

/** Sentinel for "no failure" — production code bans null/undefined returns. */
const NO_FAILURE = '' as const;
type FailureReason = string;

/**
 * Describe a cap that exceeds its canonical maximum.
 * @param expectation - The rule + cap being enforced.
 * @param actualMax - The resolved maximum.
 * @returns Failure reason.
 */
function overMaxReason(expectation: IRuleExpectation, actualMax: number): FailureReason {
  const actual = String(actualMax);
  const allowed = String(expectation.maxAllowed);
  return `rule '${expectation.ruleId}' max=${actual} > canonical ${allowed}`;
}

/**
 * Check ONE expectation against the cluster's resolved rule set.
 * @param ruleValue - Raw resolved entry for the expected rule.
 * @param expectation - The rule + cap to enforce.
 * @returns Empty string when expectation holds, else a failure reason.
 */
function checkExpectation(ruleValue: unknown, expectation: IRuleExpectation): FailureReason {
  if (ruleValue === undefined) return `rule '${expectation.ruleId}' is NOT configured`;
  if (isRuleOff(ruleValue)) return `rule '${expectation.ruleId}' is OFF`;
  const actualMax = extractRuleMax(ruleValue);
  if (actualMax < 0) return `rule '${expectation.ruleId}' has no inspectable max option`;
  if (actualMax > expectation.maxAllowed) return overMaxReason(expectation, actualMax);
  return NO_FAILURE;
}

/**
 * Build a cluster failure record.
 * @param cluster - Cluster the expectation belongs to.
 * @param ruleId - Rule that failed.
 * @param reason - Why it failed.
 * @returns One failure record.
 */
function clusterFailure(
  cluster: IClusterExpectations,
  ruleId: string,
  reason: string,
): ICoverageFailure {
  return { cluster: cluster.clusterName, file: cluster.representativeFile, ruleId, reason };
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
  const ruleValue = resolved[expectation.ruleId];
  const reason = checkExpectation(ruleValue, expectation);
  if (reason === NO_FAILURE) return [];
  return [clusterFailure(cluster, expectation.ruleId, reason)];
}

/**
 * Audit one expectation unless the cluster explicitly defers that rule.
 * @param resolved - Effective rules for the cluster's representative file.
 * @param cluster - Cluster the expectation belongs to.
 * @param expectation - Single rule cap being checked.
 * @returns Failure records, empty when deferred or satisfied.
 */
function auditExpectation(
  resolved: Record<string, unknown>,
  cluster: IClusterExpectations,
  expectation: IRuleExpectation,
): readonly ICoverageFailure[] {
  const deferred = cluster.deferredRules ?? [];
  if (deferred.includes(expectation.ruleId)) return [];
  return failuresFor(resolved, cluster, expectation);
}

/**
 * Audit ONE Pipeline cluster against its expectation list.
 *
 * Only the rules named in `deferredRules` are skipped. Every other cap in
 * the cluster is enforced, so removing a scoped declaration weakens the
 * resolved rule — raising its maximum or turning it off — and fails here.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param cluster - Cluster definition (name + representative file + caps).
 * @returns Failure records (empty when all enforced expectations hold).
 */
async function auditCluster(
  eslint: ESLint,
  cluster: IClusterExpectations,
): Promise<readonly ICoverageFailure[]> {
  const resolved = await resolveRulesForFile(eslint, cluster.representativeFile);
  return cluster.expectations.flatMap((expectation): readonly ICoverageFailure[] =>
    auditExpectation(resolved, cluster, expectation),
  );
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

const ESLINT_RUNNER = new ESLint();
const REGIME_RESULT = await auditCapRegimes(ESLINT_RUNNER);
const REGIME_FAILURES: readonly ICoverageFailure[] = REGIME_RESULT.failures.map(
  (f): ICoverageFailure => ({
    cluster: `cap regime: ${f.path}`,
    file: f.path,
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
const EXIT_CODE = printReport(ALL_FAILURES, STATUS_ROWS, REGIME_RESULT.fileCount);
process.exit(EXIT_CODE);
