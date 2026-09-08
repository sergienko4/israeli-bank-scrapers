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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');

/** YAML job-level shape we read — everything else is irrelevant. */
interface IPrYamlJob {
  readonly name?: string;
  readonly 'continue-on-error'?: unknown;
  readonly steps?: readonly {
    readonly name?: string;
    readonly run?: string;
    readonly 'continue-on-error'?: unknown;
  }[];
}

interface IPrYamlDoc {
  readonly jobs?: Readonly<Record<string, IPrYamlJob>>;
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
 * Run the workflow's guard with a chosen bash under test.
 * @param script - The guard script lifted from the workflow.
 * @param bin - The bash the guard should inspect.
 * @returns The exit status the guard produced.
 */
function runGuard(script: string, bin: string): number {
  const env = { ...process.env, BASH_BIN: bin };
  const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env });
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

  it('[PR-YAML-BASH32] the guard passes on bash 3.2 and fails on anything else', () => {
    const script = versionGuardScript();
    const present = BASH_CANDIDATES.filter(bin => existsSync(bin));
    expect(present.length).toBeGreaterThan(0);

    for (const bin of present) {
      const expected = versionOf(bin) === '3.2' ? 0 : 1;
      expect({ bin, status: runGuard(script, bin) }).toEqual({ bin, status: expected });
    }
  });
});
