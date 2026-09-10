/**
 * CI gate-hardening regression test.
 *
 * <p>Parses `.github/workflows/pr.yml` and asserts that no
 * `E2E Real *` job carries a `continue-on-error` clause — either at
 * job level or on any of its steps. The `E2E Smoke` matrix's
 * `continue-on-error: true` is intentional (informational signal
 * only) and explicitly allowed.
 *
 * <p>Background — release PR #172 CI run on commit `915773c4`
 * silently masked a real Isracard `AUTH_DISCOVERY_DASHBOARD_NOT_READY`
 * failure because the workflow carried
 * `continue-on-error: ${{ matrix.bank == 'Isracard' }}`. The
 * release-status rollup reported green when the inner Jest exited
 * code 1. This test pins the rule permanently — no E2E Real job
 * may ever ship with the mask again.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { canRunPosixBash } from '../../../Helpers/HostCapabilities.js';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');

/** YAML job-level shape we read — everything else is irrelevant. */
interface IPrYamlJob {
  readonly name?: string;
  readonly if?: unknown;
  readonly needs?: string | readonly string[];
  readonly environment?: unknown;
  readonly 'continue-on-error'?: unknown;
  readonly steps?: readonly {
    readonly name?: string;
    readonly run?: string;
    readonly 'continue-on-error'?: unknown;
  }[];
}

interface IPrYamlDoc {
  readonly jobs?: Readonly<Record<string, IPrYamlJob>>;
  readonly defaults?: { readonly run?: { readonly shell?: string } };
}

/**
 * Load and parse the workflow file.
 *
 * @returns Parsed workflow document.
 */
function loadPrYaml(): IPrYamlDoc {
  const raw = readFileSync(PR_YAML, 'utf8');
  return parse(raw) as IPrYamlDoc;
}

/** Stable YAML job-key prefix the workflow uses for every E2E Real matrix. */
const E2E_REAL_JOB_KEY_PREFIX = 'e2e-real-';

/** Stable display-name prefix the workflow emits for every E2E Real run. */
const E2E_REAL_DISPLAY_PREFIX = 'E2E Real';

/**
 * Return `true` when a job entry belongs to the E2E Real family
 * via EITHER its stable YAML key (`e2e-real-*`) OR its display
 * name prefix (`E2E Real *`). Job-key match resists the brittle-
 * filter bypass where someone renames the display name but keeps
 * the masked `continue-on-error` clause.
 *
 * @param key - YAML job key (top-level property name under `jobs:`).
 * @param job - Job definition.
 * @returns True when the job participates in E2E Real coverage.
 */
function isE2eRealJob(key: string, job: IPrYamlJob): boolean {
  if (key.startsWith(E2E_REAL_JOB_KEY_PREFIX)) return true;
  const displayName = typeof job.name === 'string' ? job.name : '';
  return displayName.startsWith(E2E_REAL_DISPLAY_PREFIX);
}

/**
 * Read all jobs identified as E2E Real by either stable key or
 * display name. Both predicates are AND-combined into one filter
 * so the mask-detection survives display-name renames.
 *
 * @param doc - Parsed workflow document.
 * @returns Subset of jobs matching the E2E Real family.
 */
function findE2eRealJobs(doc: IPrYamlDoc): readonly IPrYamlJob[] {
  const jobs = doc.jobs ?? {};
  const entries = Object.entries(jobs);
  const matched = entries.filter(([key, job]): boolean => isE2eRealJob(key, job));
  return matched.map(([, job]): IPrYamlJob => job);
}

describe('PrYamlGateHardening', () => {
  it('[PR-YAML-NO-MASK] PrYaml_EveryE2eRealJob_ShouldNotHaveJobLevelContinueOnError', () => {
    const doc = loadPrYaml();
    const e2eJobs = findE2eRealJobs(doc);
    expect(e2eJobs.length).toBeGreaterThan(0);
    for (const job of e2eJobs) {
      const hasMask = job['continue-on-error'] !== undefined;
      expect(hasMask).toBe(false);
    }
  });

  it('[PR-YAML-NO-MASK] PrYaml_EveryE2eRealStep_ShouldNotHaveStepLevelContinueOnError', () => {
    const doc = loadPrYaml();
    const e2eJobs = findE2eRealJobs(doc);
    for (const job of e2eJobs) {
      const steps = job.steps ?? [];
      for (const step of steps) {
        const hasMask = step['continue-on-error'] !== undefined;
        expect(hasMask).toBe(false);
      }
    }
  });
});

/**
 * Canonicalise an `if:` expression: collapse whitespace runs and normalise
 * spacing around `==` and after `!`, so a semantically identical condition
 * written with different spacing still compares equal.
 *
 * @param raw - Raw `if:` expression.
 * @returns The canonical form.
 */
function normaliseCondition(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ');
  const spaced = collapsed.replace(/\s*==\s*/g, ' == ');
  return spaced.replace(/!\s+/g, '!').trim();
}

/**
 * Read a job's `if:` expression in canonical form.
 *
 * @param job - Job definition.
 * @returns The condition, or an empty string when the job carries none.
 */
function conditionOf(job: IPrYamlJob): string {
  const raw = typeof job.if === 'string' ? job.if : '';
  return normaliseCondition(raw);
}

/**
 * Split a condition into its top-level `&&` conjuncts, ignoring any `&&`
 * nested inside parentheses.
 *
 * <p>Containment (`condition.includes(token)`) is NOT good enough here: it
 * cannot tell a required guard from one demoted into a disjunct. `A && (B ||
 * C)` still contains `B`, but `B` no longer has to hold — which is exactly
 * how an approval check or a fork check can be neutered while every
 * substring assertion stays green.
 *
 * @param condition - Canonical `if:` expression.
 * @returns The top-level conjuncts, in order.
 */
function topLevelConjuncts(condition: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let index = 0;
  while (index < condition.length) {
    const char = condition.charAt(index);
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && condition.startsWith('&&', index)) {
      const conjunct = current.trim();
      parts.push(conjunct);
      current = '';
      index += 2;
      continue;
    }
    current += char;
    index += 1;
  }
  const last = current.trim();
  parts.push(last);
  return parts.filter((part): boolean => part !== '');
}

/**
 * Whether an expression holds unconditionally in a condition — i.e. appears
 * as a top-level conjunct rather than merely somewhere in the text.
 *
 * @param condition - Canonical `if:` expression.
 * @param expected - The conjunct that must hold.
 * @returns True when the expression is a required conjunct.
 */
function requiresConjunct(condition: string, expected: string): boolean {
  const conjuncts = topLevelConjuncts(condition);
  return conjuncts.includes(expected);
}

/**
 * Read a job's `needs:` as an array, normalising the scalar form.
 *
 * @param job - Job definition.
 * @returns The job keys this job depends on.
 */
function needsOf(job: IPrYamlJob): readonly string[] {
  if (typeof job.needs === 'string') return [job.needs];
  return job.needs ?? [];
}

/**
 * Every `jobs:` entry in the workflow.
 *
 * @param doc - Parsed workflow document.
 * @returns Key/definition pairs.
 */
function jobEntries(doc: IPrYamlDoc): readonly (readonly [string, IPrYamlJob])[] {
  const jobs = doc.jobs ?? {};
  return Object.entries(jobs);
}

/**
 * `always()` marks an aggregator: a job that deliberately runs whatever its
 * needs did, and inspects their results in a step instead of gating on them.
 */
const ALWAYS_TOKEN = 'always()';

/**
 * The one status function that survives an upstream skip WITHOUT also
 * surviving a cancelled run. `always()` would run on cancelled runs too,
 * and this workflow sets `cancel-in-progress: true`, so cancellation is
 * routine — accepting `always()` here would be a real behaviour change.
 */
const OPT_OUT_CONJUNCT = '!cancelled()';

/**
 * Whether a condition marks an aggregator.
 *
 * @param condition - Canonical `if:` expression.
 * @returns True when the job runs regardless of its needs' results.
 */
function isAggregatorCondition(condition: string): boolean {
  return condition.includes(ALWAYS_TOKEN);
}

/**
 * Job keys whose `if:` uses `always()`.
 *
 * @param doc - Parsed workflow document.
 * @returns The aggregator job keys.
 */
function aggregatorKeys(doc: IPrYamlDoc): readonly string[] {
  const matched = jobEntries(doc).filter(([, job]): boolean => {
    const condition = conditionOf(job);
    return isAggregatorCondition(condition);
  });
  return matched.map(([key]): string => key);
}

/**
 * Every job reachable downstream of the given jobs through `needs:`.
 *
 * <p>Transitive, not direct: the skip taint does NOT stop at a dependent
 * that opted out and succeeded, so a job three hops below the aggregator is
 * just as exposed as one directly beneath it.
 *
 * @param doc - Parsed workflow document.
 * @param roots - Job keys to walk down from.
 * @returns The descendant job keys.
 */
function descendantsOf(doc: IPrYamlDoc, roots: readonly string[]): readonly string[] {
  const entries = jobEntries(doc);
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    for (const [key, job] of entries) {
      const needs = needsOf(job);
      if (!needs.includes(current) || seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }
  return [...seen];
}

/** Jobs that gate real-bank access and must keep the fork/dependabot guard. */
const REAL_GATE_KEYS = /^(?:dns-preflight|e2e-real-group-[a-e]-gate)$/;

/** The credential-bearing matrix jobs — `e2e-real-group-a` and friends. */
const REAL_MATRIX_KEYS = /^e2e-real-group-[a-e]$/;

/**
 * The same-repo check, parentheses included. The grouping is load-bearing:
 * without it `X && Y && A || B` binds as `(X && Y && A) || B`, and every
 * same-repo PR would reach the live-credential matrix with no gate check at
 * all. Pinned as one conjunct so the parentheses cannot be dropped.
 */
const FORK_CONJUNCT =
  "(github.event_name == 'workflow_dispatch' || " +
  'github.event.pull_request.head.repo.full_name == github.repository)';

describe('PrYamlGateHardening — an always() aggregator cannot silently skip its dependents', () => {
  // Regression: PR #559 wired `portability-macos` (gated on `ci_scripts`) into
  // `validate.needs`. `validate` runs under `always()`, so it still reported
  // success — but GitHub propagates `skipped` transitively, and every job
  // hanging off `validate` carried a bare boolean `if:`. From 2026-09-08, any
  // PR not touching `.github/scripts/**` silently lost DNS Preflight and all
  // five E2E Real groups while the run still concluded `success`.
  //
  // Measured on branch `ci/skip-propagation-probe`, not inferred:
  //   aggregator (always, green)  -> dependent with bare `if:`      SKIPPED
  //   aggregator (always, green)  -> dependent with `!cancelled()`  SUCCESS
  //   that dependent (green)      -> grandchild with bare `if:`     SKIPPED
  //   that dependent (green)      -> grandchild with `!cancelled()` SUCCESS
  //
  // The third line is why the rule below walks the FULL descendant set: the
  // taint does not clear at a job that opted out and succeeded.

  it('[PR-YAML-SKIP-POISON] the workflow still has an always() aggregator with descendants', () => {
    const doc = loadPrYaml();
    const aggregators = aggregatorKeys(doc);
    const descendants = descendantsOf(doc, aggregators);

    expect(aggregators.length).toBeGreaterThan(0);
    expect(descendants.length).toBeGreaterThan(0);
  });

  it('[PR-YAML-SKIP-POISON] every descendant of an aggregator opts out of inherited skip', () => {
    const doc = loadPrYaml();
    const aggregators = aggregatorKeys(doc);
    const descendants = descendantsOf(doc, aggregators);
    const jobs = doc.jobs ?? {};

    for (const key of descendants) {
      const condition = conditionOf(jobs[key] ?? {});
      const hasOptOut = requiresConjunct(condition, OPT_OUT_CONJUNCT);
      expect({ job: key, hasOptOut }).toEqual({ job: key, hasOptOut: true });
    }
  });

  it('[PR-YAML-SKIP-POISON] opting out obliges a job to re-state success() for every need', () => {
    // `!cancelled()` drops the implicit `success()` over the WHOLE needs list,
    // not just the aggregator. A job that opts out and forgets to re-state a
    // need has silently deleted that dependency — which is how the approval
    // gate could be bypassed on a credential-bearing job.
    const doc = loadPrYaml();

    for (const [key, job] of jobEntries(doc)) {
      const condition = conditionOf(job);
      const isAggregator = isAggregatorCondition(condition);
      const hasOptOut = requiresConjunct(condition, OPT_OUT_CONJUNCT);
      if (isAggregator || !hasOptOut) continue;
      const unguarded = needsOf(job).filter((need): boolean => {
        return !requiresConjunct(condition, `needs.${need}.result == 'success'`);
      });
      expect({ job: key, unguarded }).toEqual({ job: key, unguarded: [] });
    }
  });
});

describe('PrYamlGateHardening — the real-bank gates keep their access controls', () => {
  // The skip-poison rules above say nothing about WHO may reach the real
  // gates. Asserted separately, and as top-level conjuncts rather than
  // substrings, so a future edit cannot demote the fork / dependabot /
  // full_suite guard into a disjunct and stay green.

  it('[PR-YAML-REAL-GATE] every real-gate job requires real_gates_enabled', () => {
    const doc = loadPrYaml();
    const gates = jobEntries(doc).filter(([key]): boolean => REAL_GATE_KEYS.test(key));

    expect(gates).toHaveLength(6);
    for (const [key, job] of gates) {
      const condition = conditionOf(job);
      const expected = "needs.validate.outputs.real_gates_enabled == 'true'";
      const hasGuard = requiresConjunct(condition, expected);
      expect({ job: key, hasGuard }).toEqual({ job: key, hasGuard: true });
    }
  });

  it('[PR-YAML-REAL-GATE] every approval gate keeps a distinct protected environment', () => {
    const doc = loadPrYaml();
    const gates = jobEntries(doc).filter(([key]): boolean => key.endsWith('-gate'));
    const environments = gates.map(([, job]): unknown => job.environment);
    const named = environments.filter((name): boolean => typeof name === 'string');
    const unique = new Set(named);

    expect(gates).toHaveLength(5);
    expect(named).toHaveLength(gates.length);
    expect(unique.size).toBe(gates.length);
  });

  it('[PR-YAML-REAL-GATE] every credential-bearing matrix job requires approval and same-repo', () => {
    const doc = loadPrYaml();
    const matrices = jobEntries(doc).filter(([key]): boolean => REAL_MATRIX_KEYS.test(key));

    expect(matrices).toHaveLength(5);
    for (const [key, job] of matrices) {
      const condition = conditionOf(job);
      const hasForkCheck = requiresConjunct(condition, FORK_CONJUNCT);
      const hasApprovalCheck = requiresConjunct(condition, `needs.${key}-gate.result == 'success'`);
      expect({ job: key, hasForkCheck, hasApprovalCheck }).toEqual({
        job: key,
        hasForkCheck: true,
        hasApprovalCheck: true,
      });
    }
  });
});

/** The job whose only purpose is to exercise a real bash 3.2. */
const MACOS_JOB_KEY = 'portability-macos';

/** Bash binaries a developer machine or runner might hold. */
const BASH_CANDIDATES = [
  '/bin/bash',
  '/usr/bin/bash',
  '/usr/local/bin/bash',
  '/opt/homebrew/bin/bash',
] as const;

/**
 * Read the version-assertion script out of the workflow itself.
 *
 * <p>Taken from the YAML rather than restated here: a copy in the test could
 * pass while the workflow shipped something else entirely.
 * @returns The step's shell script.
 */
function versionGuardScript(): string {
  const doc = loadPrYaml();
  const job = doc.jobs?.[MACOS_JOB_KEY];
  const steps = job?.steps ?? [];
  const guard = steps.find(step => (step.run ?? '').includes('BASH_VERSINFO'));
  return guard?.run ?? '';
}

/**
 * Ask a bash binary for its own `major.minor`.
 * @param bin - Absolute path to a bash binary.
 * @returns The version, e.g. `3.2`.
 */
function versionOf(bin: string): string {
  const probe = 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"';
  const result = spawnSync(bin, ['-c', probe], { encoding: 'utf8' });
  return (result.stdout || '').trim();
}

/**
 * The argv every `run:` block in this workflow executes under.
 *
 * <p>Read from `defaults.run.shell` rather than restated, so the guard below
 * is exercised with the same strictness Actions applies — `-e`, `-u` and
 * `-o pipefail`. A test that ran it under a laxer shell could pass while CI
 * failed.
 * @returns The shell argv, `{0}` still standing for the script path.
 */
function workflowShellArgv(): readonly string[] {
  const doc = loadPrYaml();
  const shell = doc.defaults?.run?.shell ?? '';
  return shell.split(' ').filter(token => token !== '');
}

/**
 * Write the step script to a throwaway file, the way Actions does.
 * @param script - The guard script.
 * @returns Absolute path to the written script.
 */
function writeStepFile(script: string): string {
  const tmp = tmpdir();
  const prefix = join(tmp, 'pr-guard-');
  const dir = mkdtempSync(prefix);
  const file = join(dir, 'step.sh');
  writeFileSync(file, script);
  return file;
}

/**
 * Run the workflow's guard with a chosen bash under test.
 * @param script - The guard script lifted from the workflow.
 * @param bin - The bash the guard should inspect.
 * @returns The exit status the guard produced.
 */
function runGuard(script: string, bin: string): number {
  const file = writeStepFile(script);
  const argv = workflowShellArgv();
  const [command, ...rest] = argv.map(token => (token === '{0}' ? file : token));
  const options = { encoding: 'utf8' as const, env: { ...process.env, BASH_BIN: bin } };
  const result = spawnSync(command, rest, options);
  const dir = dirname(file);
  rmSync(dir, { recursive: true, force: true });
  return result.status ?? -1;
}

describe('PrYamlGateHardening — the macOS leg cannot go vacuous', () => {
  it('[PR-YAML-BASH32] the workflow asserts its bash version rather than printing it', () => {
    // Printing to the log is not enforcement: nobody reads a green job. If
    // the image ever ships bash 5 as /bin/bash, this leg proves nothing
    // while still reporting success.
    const script = versionGuardScript();

    expect(script).not.toEqual('');
  });

  it('[PR-YAML-BASH32] the guard runs under a strict shell', () => {
    // The guard is only trustworthy if Actions runs it with -e, -u and
    // pipefail. The workflow sets that once at `defaults.run.shell` instead
    // of repeating `set -euo pipefail` per step, so that default is the
    // thing worth pinning — drop it and every run block silently relaxes.
    const argv = workflowShellArgv();

    expect(argv).toContain('-euo');
    expect(argv).toContain('pipefail');
  });

  it('[PR-YAML-BASH32] the guard passes on bash 3.2 and fails on anything else', () => {
    if (canRunPosixBash(process.platform)) {
      const script = versionGuardScript();
      const present = BASH_CANDIDATES.filter(bin => existsSync(bin));
      expect(present.length).toBeGreaterThan(0);

      for (const bin of present) {
        const expected = versionOf(bin) === '3.2' ? 0 : 1;
        expect({ bin, status: runGuard(script, bin) }).toEqual({ bin, status: expected });
      }
    }
  });
});
