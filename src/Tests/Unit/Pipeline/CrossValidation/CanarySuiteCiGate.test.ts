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
  readonly 'continue-on-error'?: unknown;
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
 * The one run block the canary step is allowed to carry.
 *
 * <p>A blacklist of masking constructs cannot be honest: `; true`,
 * `|| echo ok`, a pipeline, a leading `#`, `set +e` and background execution
 * all discard the exit status, and no list of them is ever complete. An exact
 * contract inverts the burden — any rewrite, however it is spelled, stops
 * matching and turns this suite red until someone changes it deliberately.
 */
const CANARY_RUN = 'npm run lint:canaries';

/** Unmasked shell the `lint:canaries` npm script must resolve to. */
const CANARY_SCRIPT = 'bash src/Scrapers/Pipeline/EslintCanaries/verify.sh';

/** Manifest shape this test reads. */
interface IManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

/**
 * Read the shell the canary npm script resolves to.
 *
 * <p>Pinning the workflow step alone leaves the indirection unguarded: the
 * step can be exactly right while `lint:canaries` itself is rewritten to
 * swallow the failure.
 *
 * @returns The declared script body, normalized, or an empty string.
 */
function canaryNpmScript(): string {
  const manifestPath = join(REPO_ROOT, 'package.json');
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as IManifest;
  const script = manifest.scripts?.[CANARY_COMMAND] ?? '';
  return normalizeRun(script);
}

/**
 * Collapse a workflow run block to a single normalized line.
 *
 * @param run - Raw `run:` body.
 * @returns The body with surrounding and repeated whitespace removed.
 */
function normalizeRun(run: string): string {
  const trimmed = run.trim();
  return trimmed.replace(/\s+/gu, ' ');
}

/**
 * Identify the step invoking the canary suite, unmasked.
 *
 * @param step - Step definition.
 * @returns True when the step runs exactly the approved command.
 */
function isCanaryStep(step: IStep): boolean {
  const run = step.run ?? '';
  const normalized = normalizeRun(run);
  return normalized === CANARY_RUN;
}

/**
 * Identify a job whose failures still fail the workflow.
 *
 * <p>`continue-on-error` at job level masks a failed canary step just as
 * effectively as it does at step level, and is invisible to any assertion
 * that only walks steps.
 *
 * @param job - Job definition.
 * @returns True when the job carries no failure mask.
 */
function isUnmaskedJob(job: IJob): boolean {
  return job['continue-on-error'] === undefined;
}

/**
 * Run blocks that must never be accepted as canary wiring.
 *
 * <p>Written out literally rather than derived from the detector: a table
 * generated from the implementation shrinks whenever the implementation does,
 * so it would pass vacuously on the day the detector stopped rejecting
 * anything. Every entry below exits zero after a failed suite, never runs it,
 * or runs something else entirely.
 */
const MASKED_RUN_BLOCKS: readonly string[] = [
  'npm run lint:canaries || true',
  'npm run lint:canaries || :',
  'npm run lint:canaries || exit 0',
  'npm run lint:canaries || echo ignored',
  'npm run lint:canaries; true',
  'npm run lint:canaries | cat',
  'set +e\nnpm run lint:canaries',
  'if ! npm run lint:canaries; then echo soft; fi',
  'npm run lint:canaries &',
  'npm run --if-present lint:canaries',
  '# npm run lint:canaries',
  'echo npm run lint:canaries',
];

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

  it('[CI-CANARY] Detector_ShellMaskedCanaryStep_ShouldNotCountAsWired', () => {
    const verdicts = MASKED_RUN_BLOCKS.map(run => isCanaryStep({ run }));
    const hasAnyAccepted = verdicts.some(verdict => verdict);
    expect(hasAnyAccepted).toBe(false);
  });

  it('[CI-CANARY] Detector_MaskTable_ShouldStayNonEmpty', () => {
    expect(MASKED_RUN_BLOCKS.length).toBeGreaterThanOrEqual(12);
  });

  it('[CI-CANARY] Detector_UnmaskedCanaryStep_ShouldCountAsWired', () => {
    const step = { run: CANARY_RUN };
    const isWired = isCanaryStep(step);
    expect(isWired).toBe(true);
  });

  it('[CI-CANARY] Detector_JobLevelContinueOnError_ShouldNotCountAsUnmasked', () => {
    const job: IJob = { 'continue-on-error': true };
    const isUnmasked = isUnmaskedJob(job);
    expect(isUnmasked).toBe(false);
  });

  it('[CI-CANARY] PrYaml_CanaryOwningJob_ShouldNotBeMaskedByContinueOnError', () => {
    const jobs = canaryJobs();
    expect(jobs.length).toBeGreaterThan(0);
    const verdicts = jobs.map(job => isUnmaskedJob(job));
    const hasAnyMasked = verdicts.some(verdict => !verdict);
    expect(hasAnyMasked).toBe(false);
  });

  it('[CI-CANARY] PackageJson_CanaryScript_ShouldInvokeVerifyUnmasked', () => {
    const script = canaryNpmScript();
    expect(script).toBe(CANARY_SCRIPT);
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
