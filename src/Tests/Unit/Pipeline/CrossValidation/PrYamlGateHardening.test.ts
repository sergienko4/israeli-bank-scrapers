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

/**
 * Read all jobs whose `name` field starts with `E2E Real`.
 *
 * @param doc - Parsed workflow document.
 * @returns Subset of jobs matching the `E2E Real *` prefix.
 */
function findE2eRealJobs(doc: IPrYamlDoc): readonly IPrYamlJob[] {
  const jobs = doc.jobs ?? {};
  const jobValues = Object.values(jobs);
  return jobValues.filter((j): boolean => {
    const n = typeof j.name === 'string' ? j.name : '';
    return n.startsWith('E2E Real');
  });
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
