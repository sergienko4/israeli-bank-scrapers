/**
 * Contract for the `SonarCloud Scan` job in `pr.yml`.
 *
 * <p>Branch protection requires a `SonarCloud Scan` check on every PR. The job
 * that reports it scans the lcov the floor `Unit tests` leg uploads, rather
 * than running the suite again. Three ways it could pass without scanning:
 * a skipped required job counts as passed, so the job must not be skippable
 * by a failed upstream; a step-level `if:` copied from `sonarcloud.yml` would
 * skip the scan and leave the job green; and a second `pull_request` workflow
 * reporting the same name would leave two contexts with one name.
 *
 * <p>SPS-4 also keeps a superseded run from holding a runner: the job-level
 * `always()` survives cancellation, but GitHub then re-checks each step's
 * `if`, and a step that names no status function means `success()`.
 *
 * Rules:
 *   SPS-1  only `pr.yml`'s `sonarcloud` job reports `SonarCloud Scan` on PRs
 *   SPS-2  the job needs `changes` and `unit-tests` under the pinned `always()` guard
 *   SPS-3  its first step passes only when both needs succeeded
 *   SPS-4  no step can be skipped except the PR-only count gate
 *   SPS-5  it scans the artifact the coverage leg uploads, where Sonar reads it
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { canRunPosixBash } from '../../../Helpers/HostCapabilities.js';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows');
const SONAR_PROPERTIES = join(REPO_ROOT, 'sonar-project.properties');

const CONTEXT = 'SonarCloud Scan';
const JOB_KEY = 'sonarcloud';
const TRUST_STEP = 'Require trusted inputs';
const DOWNLOAD_STEP = 'Download coverage report';
const UPLOAD_STEP = 'Upload coverage artifact';
const COUNT_GATE_STEP = 'Fail on any new SonarCloud issues (count gate)';
const PR_ONLY_IF = "github.event_name == 'pull_request'";
const SCAN_ACTION = 'SonarSource/sonarqube-scan-action@';

/**
 * The job's `if:`. `always()` keeps a failed or cancelled upstream from
 * skipping the job (a skipped required check passes); the event guard keeps
 * `workflow_dispatch` runs out; the last clause skips only a successful
 * `changes` that saw no `src/**` change.
 */
const JOB_IF =
  "always() && github.event_name == 'pull_request' && " +
  "(needs.changes.result != 'success' || needs.changes.outputs.src == 'true')";

/** Every `needs.*.result` value Actions can report, plus an unset one. */
const RESULTS = ['success', 'failure', 'cancelled', 'skipped', ''] as const;

/** `[changes, unit-tests]` result pairs, every combination. */
const RESULT_PAIRS = RESULTS.flatMap((changes): (readonly [string, string])[] =>
  RESULTS.map((unit): readonly [string, string] => [changes, unit]),
);

/** Step fields this suite reads. */
interface IStep {
  readonly name?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, string>>;
}

/** Job fields this suite reads. */
interface IJob {
  readonly name?: string;
  readonly needs?: string | readonly string[];
  readonly if?: string;
  readonly steps?: readonly IStep[];
}

/** Workflow fields this suite reads. */
interface IWorkflowDoc {
  readonly on?: string | readonly string[] | Readonly<Record<string, unknown>>;
  readonly defaults?: { readonly run?: { readonly shell?: string } };
  readonly jobs?: Readonly<Record<string, IJob>>;
}

/**
 * Parse one workflow file.
 * @param file - File name under `.github/workflows`.
 * @returns The parsed document.
 */
function loadWorkflow(file: string): IWorkflowDoc {
  const path = join(WORKFLOWS_DIR, file);
  const text = readFileSync(path, 'utf8');
  return parse(text) as IWorkflowDoc;
}

/**
 * Every workflow file name.
 * @returns The `.yml` / `.yaml` files under `.github/workflows`.
 */
function workflowFiles(): readonly string[] {
  const names = readdirSync(WORKFLOWS_DIR);
  return names.filter((name): boolean => /\.ya?ml$/u.test(name)).sort();
}

/**
 * Event names a workflow triggers on.
 * @param doc - Parsed workflow.
 * @returns The `on:` events, whichever YAML shape declares them.
 */
function triggersOf(doc: IWorkflowDoc): readonly string[] {
  const on = doc.on ?? [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on as readonly string[];
  return Object.keys(on);
}

/**
 * `file:job` for every job reporting the context on a `pull_request` run.
 * @returns The matching jobs across all workflows.
 */
function prJobsNamedContext(): readonly string[] {
  return workflowFiles().flatMap((file): string[] => {
    const doc = loadWorkflow(file);
    if (!triggersOf(doc).includes('pull_request')) return [];
    const jobs = Object.entries(doc.jobs ?? {});
    const named = jobs.filter(([, job]): boolean => job.name === CONTEXT);
    return named.map(([key]): string => `${file}:${key}`);
  });
}

/**
 * The `pr.yml` job under test.
 * @returns The job.
 */
function sonarJob(): IJob {
  const doc = loadWorkflow('pr.yml');
  return doc.jobs?.[JOB_KEY] ?? {};
}

/**
 * The one step with this name in a `pr.yml` job.
 * @param jobKey - Job key.
 * @param name - Step name.
 * @returns The step; throws unless exactly one step carries the name.
 */
function stepNamed(jobKey: string, name: string): IStep {
  const steps = loadWorkflow('pr.yml').jobs?.[jobKey]?.steps ?? [];
  const hits = steps.filter((step): boolean => step.name === name);
  if (hits.length !== 1) {
    throw new RangeError(`expected one "${name}" step, found ${String(hits.length)}`);
  }
  return hits[0];
}

/**
 * Exit status of the trust step for one pair of upstream results, run the way
 * Actions does: from a file, under `pr.yml`'s `defaults.run.shell`.
 * @param pair - `[changes result, unit-tests result]`.
 * @returns The exit status.
 */
function trustStatus(pair: readonly [string, string]): number {
  const temp = tmpdir();
  const prefix = join(temp, 'sps-');
  const dir = mkdtempSync(prefix);
  try {
    const file = join(dir, 'step.sh');
    writeFileSync(file, stepNamed(JOB_KEY, TRUST_STEP).run ?? '');
    const shell = loadWorkflow('pr.yml').defaults?.run?.shell ?? '';
    const argv = shell.split(' ').filter((token): boolean => token !== '');
    const [command, ...rest] = argv.map((token): string => (token === '{0}' ? file : token));
    const env = { ...process.env, CHANGES_RESULT: pair[0], UNIT_TESTS_RESULT: pair[1] };
    return spawnSync(command, rest, { cwd: dir, env }).status ?? -1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The lcov paths Sonar reads.
 * @returns `sonar.javascript.lcov.reportPaths`, split.
 */
function lcovReportPaths(): readonly string[] {
  const text = readFileSync(SONAR_PROPERTIES, 'utf8');
  const line = /^sonar\.javascript\.lcov\.reportPaths=(.*)$/mu.exec(text)?.[1] ?? '';
  return line.split(',').map((path): string => path.trim());
}

describe('SonarPrScanGate', () => {
  it('[SPS-1] OnlyPrYamlSonarcloudJob_ShouldReportTheRequiredContextOnPullRequests', () => {
    const reporters = prJobsNamedContext();
    expect(reporters).toEqual([`pr.yml:${JOB_KEY}`]);
  });

  it('[SPS-2] Job_ShouldNeedChangesAndUnitTests_UnderThePinnedAlwaysGuard', () => {
    const job = sonarJob();
    const condition = (job.if ?? '').replace(/\s+/gu, ' ').trim();
    expect(job.needs).toEqual(['changes', 'unit-tests']);
    expect(condition).toBe(JOB_IF);
  });

  it('[SPS-3] TrustStep_ShouldBeFirst_AndReadBothResults', () => {
    const steps = sonarJob().steps ?? [];
    expect(steps[0]?.name).toBe(TRUST_STEP);
    expect(steps[0]?.env).toEqual({
      CHANGES_RESULT: '${{ needs.changes.result }}',
      UNIT_TESTS_RESULT: '${{ needs.unit-tests.result }}',
    });
  });

  it.each(RESULT_PAIRS)('[SPS-3] TrustStep_Changes_%j_UnitTests_%j_ShouldGate', (changes, unit) => {
    if (canRunPosixBash(process.platform)) {
      const status = trustStatus([changes, unit]);
      const shouldPass = changes === 'success' && unit === 'success';
      expect({ changes, unit, passes: status === 0 }).toEqual({
        changes,
        unit,
        passes: shouldPass,
      });
    }
  });

  it('[SPS-4] Steps_ShouldNotBeSkippable_ExceptThePrOnlyCountGate', () => {
    const steps = sonarJob().steps ?? [];
    const guarded = steps.filter((step): boolean => step.if !== undefined);
    const scans = steps.filter((step): boolean => (step.uses ?? '').startsWith(SCAN_ACTION));
    const conditions = guarded.map((step): string => `${step.name ?? ''}: ${step.if ?? ''}`);
    expect(conditions).toEqual([`${COUNT_GATE_STEP}: ${PR_ONLY_IF}`]);
    expect(scans).toHaveLength(1);
  });

  it('[SPS-5] Download_ShouldFetchTheUploadedCoverage_WhereSonarReadsIt', () => {
    const upload = stepNamed('unit-tests', UPLOAD_STEP).with ?? {};
    const download = stepNamed(JOB_KEY, DOWNLOAD_STEP).with ?? {};
    const steps = sonarJob().steps ?? [];
    const order = [DOWNLOAD_STEP, CONTEXT].map((name): number =>
      steps.findIndex((step): boolean => step.name === name),
    );
    expect({ name: download.name, path: download.path }).toEqual({
      name: upload.name,
      path: upload.path,
    });
    const lcov = posix.join(download.path, 'lcov.info');
    const sonarReads = lcovReportPaths();
    expect(sonarReads).toContain(lcov);
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]);
  });
});
