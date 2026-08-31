/**
 * Canary-suite CI wiring regression test.
 *
 * <p>The architectural canaries under `src/Scrapers/Pipeline/EslintCanaries/`
 * are the only proof that each `no-restricted-syntax` guardrail still fires on
 * the rule it was written for. `npm run lint` chains them, but the CI lint step
 * invokes `npx eslint src` directly, so the suite ran nowhere in CI: the sole
 * enforcement was the pre-commit hook, which `--no-verify` bypasses and which
 * never runs for a pull request opened from a fork.
 *
 * <p>This pins the wiring so the step cannot be dropped, masked with
 * `continue-on-error`, or left gated behind a job that skips on the one change
 * most able to disarm a guardrail — a config-only edit, touching no `src/` file.
 *
 * <p>Every assertion here is mutation-proven: removing the step, masking it, or
 * dropping the flag from the job, the step or the dependency install each turn
 * this suite red.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const DETECTOR = join(REPO_ROOT, '.github/scripts/ci/detect-changes.sh');

/** npm script running `verify.sh` and the three assertions inside it. */
const CANARY_COMMAND = 'lint:canaries';

/** Change-detection flag covering config-only edits to the guardrails. */
const GUARDRAIL_FLAG = 'syntax_guardrails';

/** Composite action the workflow uses to provision `node_modules`. */
const INSTALL_ACTION = 'setup-node-deps';

/** Sibling flags sharing the detector's emit lifecycle exactly. */
const SIBLING_FLAGS = ['full_suite', 'ci_scripts', 'deps'] as const;

/** Workflow step shape this test reads — everything else is irrelevant. */
interface IStep {
  readonly run?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly 'continue-on-error'?: unknown;
}

/** Workflow job shape this test reads. */
interface IJob {
  readonly if?: string;
  readonly steps?: readonly IStep[];
}

/** Parsed workflow document. */
interface IPrYamlDoc {
  readonly jobs?: Readonly<Record<string, IJob>>;
}

/**
 * Parse the pull-request workflow.
 *
 * @returns Parsed workflow document.
 */
function loadPrYaml(): IPrYamlDoc {
  const raw = readFileSync(PR_YAML, 'utf8');
  return parse(raw) as IPrYamlDoc;
}

/**
 * Read every job declared by the workflow.
 *
 * @returns Job definitions in declaration order.
 */
function allJobs(): readonly IJob[] {
  const doc = loadPrYaml();
  const jobs = doc.jobs ?? {};
  return Object.values(jobs);
}

/**
 * Read a job's steps defensively.
 *
 * @param job - Job definition.
 * @returns Declared steps, or an empty list.
 */
function stepsOf(job: IJob): readonly IStep[] {
  return job.steps ?? [];
}

/**
 * Identify the step invoking the canary suite.
 *
 * @param step - Step definition.
 * @returns True when the step runs the canary npm script.
 */
function isCanaryStep(step: IStep): boolean {
  const run = step.run ?? '';
  return run.includes(CANARY_COMMAND);
}

/**
 * Identify the step installing dependencies, however it is spelled.
 *
 * <p>The workflow delegates to a composite action rather than calling `npm ci`
 * inline; matching both spellings keeps a rewrite to either form from silently
 * dropping this assertion.
 *
 * @param step - Step definition.
 * @returns True when the step provisions `node_modules`.
 */
function isInstallStep(step: IStep): boolean {
  const uses = step.uses ?? '';
  const run = step.run ?? '';
  return uses.includes(INSTALL_ACTION) || run.includes('npm ci');
}

/**
 * Decide whether a job runs the canary suite.
 *
 * @param job - Job definition.
 * @returns True when any of its steps invoke the suite.
 */
function jobRunsCanary(job: IJob): boolean {
  const steps = stepsOf(job);
  return steps.some(isCanaryStep);
}

/**
 * Locate every job owning a canary step.
 *
 * @returns Owning jobs, empty when the suite runs nowhere.
 */
function canaryJobs(): readonly IJob[] {
  const jobs = allJobs();
  return jobs.filter(jobRunsCanary);
}

/**
 * Flatten the steps of every canary-owning job.
 *
 * @returns All steps belonging to those jobs.
 */
function canaryJobSteps(): readonly IStep[] {
  const jobs = canaryJobs();
  const nested = jobs.map(stepsOf);
  return nested.flat();
}

/**
 * Count the shell lines emitting a named change-detection flag.
 *
 * @param flag - Flag name as written in the detector's `echo`.
 * @returns Number of emit sites.
 */
function emitSiteCount(flag: string): number {
  const shell = readFileSync(DETECTOR, 'utf8');
  const lines = shell.split('\n');
  const needle = `echo "${flag}=`;
  const hits = lines.filter((line): boolean => line.includes(needle));
  return hits.length;
}

describe('CanarySuiteCiGate', () => {
  it('[CI-CANARY] PrYaml_CanarySuite_ShouldRunInExactlyOneJob', () => {
    const jobs = canaryJobs();
    expect(jobs.length).toBe(1);
  });

  it('[CI-CANARY] PrYaml_CanaryStep_ShouldNotBeMaskedByContinueOnError', () => {
    const steps = canaryJobSteps();
    const canaries = steps.filter(isCanaryStep);
    expect(canaries.length).toBeGreaterThan(0);
    for (const step of canaries) expect(step['continue-on-error']).toBeUndefined();
  });

  it('[CI-CANARY] PrYaml_CanaryOwningJob_ShouldAdmitGuardrailOnlyChanges', () => {
    const jobs = canaryJobs();
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) expect(job.if ?? '').toContain(GUARDRAIL_FLAG);
  });

  it('[CI-CANARY] PrYaml_CanaryStep_ShouldAdmitGuardrailOnlyChanges', () => {
    const steps = canaryJobSteps();
    const canaries = steps.filter(isCanaryStep);
    expect(canaries.length).toBeGreaterThan(0);
    for (const step of canaries) expect(step.if ?? '').toContain(GUARDRAIL_FLAG);
  });

  it('[CI-CANARY] PrYaml_DependencyInstall_ShouldAdmitGuardrailOnlyChanges', () => {
    const steps = canaryJobSteps();
    const installs = steps.filter(isInstallStep);
    expect(installs.length).toBeGreaterThan(0);
    for (const step of installs) expect(step.if ?? '').toContain(GUARDRAIL_FLAG);
  });

  it('[CI-CANARY] Detector_GuardrailFlag_ShouldEmitAtEverySiblingExitPath', () => {
    const guardrailSites = emitSiteCount(GUARDRAIL_FLAG);
    expect(guardrailSites).toBeGreaterThan(0);
    for (const sibling of SIBLING_FLAGS) {
      const siblingSites = emitSiteCount(sibling);
      expect(guardrailSites).toBe(siblingSites);
    }
  });
});
