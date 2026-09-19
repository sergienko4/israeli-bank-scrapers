/**
 * Release publish/availability gate wiring test.
 *
 * <p>npm scans every publish before the version becomes installable, so
 * `npm publish` exiting 0 no longer means a consumer can install the release.
 * npm documents the delay as "typically around five minutes... up to 15
 * minutes or more" and instructs publishers to update automation that assumes
 * immediate availability.
 *
 * <p>Release 8.7.2 is what that costs when the automation has not been
 * updated. The publish succeeded; the version became installable 127s later —
 * a fast scan by npm's own numbers — but `verify-npm-publish.sh` allowed only
 * 12 x 10s and had given up 16s earlier. The run went red for a release that
 * shipped correctly, and because `npm publish` is not idempotent the re-run
 * died with "cannot publish over the previously published versions". Both
 * runs red, no recovery path.
 *
 * <p>This pins the four properties that keep that from recurring, each of
 * which can be removed by an edit that nothing else would catch:
 *
 * <ul>
 *   <li>the verifier waits for npm's documented ceiling, not its typical
 *       case, because 8.7.2 was already faster than typical;</li>
 *   <li>the job lives long enough to spend that whole budget, or the runner
 *       kills the poll before the gate can pass;</li>
 *   <li>a non-zero `npm publish` does not by itself fail the job, or a
 *       re-run can never recover a release whose verification timed out;</li>
 *   <li>verification still runs, and still decides — tolerating the publish
 *       failure is only safe because the registry is consulted afterwards.</li>
 * </ul>
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const RELEASE_YAML = join(REPO_ROOT, '.github/workflows/release.yml');
const VERIFY_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/verify-npm-publish.sh');

/** YAML job key that builds, publishes and verifies the tarball. */
const PUBLISH_JOB_KEY = 'publish';

/**
 * The slow end of npm's documented scan window — "up to 15 minutes or more".
 * The budget is sized against this rather than the five-minute typical case,
 * because 8.7.2 cleared in 127s and still lost.
 */
const NPM_SCAN_CEILING_SECONDS = 900;

/**
 * Minutes the job needs for everything that is not the availability poll:
 * checkout, `npm ci`, the package build and the publish request itself. Sized
 * from the 8.7.2 run, where publish began 55s into the job.
 */
const NON_POLL_MINUTES = 5;

/** Defaults the verifier applies when the environment overrides nothing. */
const ATTEMPTS_DEFAULT_RE = /VERIFY_MAX_ATTEMPTS:-(\d+)/;
const SLEEP_DEFAULT_RE = /VERIFY_SLEEP_SECONDS:-(\d+)/;

/**
 * Ways a `run` block can keep a non-zero `npm publish` from failing the job.
 * Any one of them preserves the re-run path; the test does not care which.
 */
const PUBLISH_TOLERANCE_RE = /if\s+npm publish|npm publish[^\n]*\|\||publish_rc|\bset \+e\b/;

/** Step-level shape this test reads — everything else is irrelevant. */
interface IWorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

interface IWorkflowJob {
  readonly 'timeout-minutes'?: number;
  readonly steps?: readonly IWorkflowStep[];
}

interface IWorkflowDoc {
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Parse the release workflow.
 *
 * @returns Parsed workflow document.
 */
function loadWorkflow(): IWorkflowDoc {
  const raw = readFileSync(RELEASE_YAML, 'utf8');
  return parse(raw) as IWorkflowDoc;
}

/**
 * The publish job itself.
 *
 * @returns The publish job, or an empty job when it no longer exists.
 */
function publishJob(): IWorkflowJob {
  const doc = loadWorkflow();
  return doc.jobs?.[PUBLISH_JOB_KEY] ?? {};
}

/**
 * Steps of the publish job.
 *
 * @returns Every step declared by the publish job, in order.
 */
function publishSteps(): readonly IWorkflowStep[] {
  const job = publishJob();
  return job.steps ?? [];
}

/**
 * The step that invokes `npm publish`.
 *
 * @returns That step, or an empty step when nothing publishes.
 */
function publishStep(): IWorkflowStep {
  const steps = publishSteps();
  const found = steps.find(step => (step.run ?? '').includes('npm publish'));
  return found ?? {};
}

/**
 * Read the verifier's own defaults rather than restating them, so this test
 * tracks what the script will actually wait for.
 *
 * @returns Default poll budget in seconds, or 0 when the script declares none.
 */
function verifierBudgetSeconds(): number {
  const script = readFileSync(VERIFY_SCRIPT, 'utf8');
  const attempts = ATTEMPTS_DEFAULT_RE.exec(script);
  const sleep = SLEEP_DEFAULT_RE.exec(script);
  return Number(attempts?.[1] ?? 0) * Number(sleep?.[1] ?? 0);
}

describe('release.yml — the publish job can outlast npm publish-time scanning', () => {
  it('waits at least as long as npm documents a scan can take', () => {
    const budget = verifierBudgetSeconds();

    expect(budget).toBeGreaterThanOrEqual(NPM_SCAN_CEILING_SECONDS);
  });

  it('allows the verifier to spend its whole budget before the runner kills it', () => {
    const budget = verifierBudgetSeconds();
    const pollMinutes = Math.ceil(budget / 60);
    const timeout = publishJob()['timeout-minutes'];

    expect(timeout).toBeGreaterThanOrEqual(pollMinutes + NON_POLL_MINUTES);
  });

  it('still verifies the release after publishing', () => {
    const steps = publishSteps();
    const hasVerifyStep = steps.some(step => (step.run ?? '').includes('verify-npm-publish.sh'));

    expect(hasVerifyStep).toBe(true);
  });
});

describe('release.yml — a re-run recovers a release whose verification timed out', () => {
  it('does not let a non-zero npm publish fail the job on its own', () => {
    const step = publishStep();

    expect(step.run ?? '').toMatch(PUBLISH_TOLERANCE_RE);
  });

  it('records the publish outcome so a tolerated failure is never silent', () => {
    const step = publishStep();

    expect(step.run ?? '').toMatch(/::warning::/);
  });
});
