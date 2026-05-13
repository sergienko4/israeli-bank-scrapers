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

import { readFileSync } from 'node:fs';
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
  readonly steps?: readonly { readonly 'continue-on-error'?: unknown }[];
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
