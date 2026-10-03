/**
 * Workflow shell policy.
 *
 * <p>Scorecard's `PinnedDependenciesID` check, which the `scorecard-npm-pins`
 * gate runs, parses a workflow `run:` script only when the step's shell is a
 * single word naming `bash`, `sh` or `mksh` (`/bin/bash` and `BASH` count). It
 * reads `shell:` on the step, then `defaults.run.shell` on the job, and
 * otherwise assumes the runner's default. It ignores workflow-level
 * `defaults`. A `shell:` value with arguments (`bash -e {0}`), `pwsh`, or a
 * Windows runner is skipped silently, with no alert and no "incomplete
 * results" note, so an unpinned `npm install` there would pass both the gate
 * and the scheduled scan. This policy keeps every workflow step where the
 * engine can see it, and is deliberately stricter than the engine.
 *
 * <p>Scorecard does not scan composite actions at all. Their steps are held to
 * bash or sh so they run in the same shell family. Their npm commands are
 * outside both the gate and the scheduled scan.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows');
const ACTIONS_DIR = join(REPO_ROOT, '.github/actions');

/** The step- or job-level shells allowed: exactly `bash` or `sh`, no arguments. */
const SCANNED_SHELL = /^(?:bash|sh)$/;

/** A workflow-level default shell that runs bash or sh, with any arguments. */
const BASH_FAMILY_SHELL = /^(?:bash|sh)(?:\s|$)/;

/** A runner label that defaults an unset shell to something other than bash. */
const NON_BASH_RUNNER = /windows|\$\{\{/i;

/** A YAML workflow or action file. */
const YAML_FILE = /\.ya?ml$/;

/** A `defaults` block. */
interface IRunDefaults {
  readonly run?: { readonly shell?: string };
}

/** A workflow or composite-action step. */
interface IStep {
  readonly run?: string;
  readonly shell?: string;
}

/** A workflow job; reusable-workflow calls have no steps. */
interface IJob {
  readonly 'runs-on'?: unknown;
  readonly defaults?: IRunDefaults;
  readonly steps?: readonly IStep[];
}

/** A workflow file. */
interface IWorkflow {
  readonly defaults?: IRunDefaults;
  readonly jobs?: Readonly<Record<string, IJob>>;
}

/** A composite action's `action.yml`. */
interface IComposite {
  readonly runs?: { readonly steps?: readonly IStep[] };
}

/** A synthetic workflow and whether the policy must accept it. */
interface IPolicyCase {
  readonly name: string;
  readonly doc: IWorkflow;
  readonly isAccepted: boolean;
}

/**
 * Parse a YAML file.
 *
 * @param path - File path.
 * @returns Parsed document.
 */
function loadYaml(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  return parse(text) as unknown;
}

/**
 * Every workflow file GitHub runs.
 *
 * @returns Absolute paths.
 */
function workflowFiles(): string[] {
  const names = readdirSync(WORKFLOWS_DIR).filter(name => YAML_FILE.test(name));
  return names.map(name => join(WORKFLOWS_DIR, name));
}

/**
 * Every composite action's metadata file.
 *
 * @returns Absolute paths.
 */
function actionFiles(): string[] {
  const dirs = readdirSync(ACTIONS_DIR);
  const files = dirs.flatMap(dir => ['action.yml', 'action.yaml'].map(name => join(dir, name)));
  const existing = new Set(readdirSync(ACTIONS_DIR, { recursive: true, encoding: 'utf8' }));
  return files.filter(file => existing.has(file)).map(file => join(ACTIONS_DIR, file));
}

/**
 * Whether a runner label is a literal whose default shell is bash.
 *
 * @param label - One `runs-on` label.
 * @returns True for a non-empty literal that is not Windows.
 */
function isBashRunnerLabel(label: unknown): boolean {
  return typeof label === 'string' && label !== '' && !NON_BASH_RUNNER.test(label);
}

/**
 * Whether a composite-action step declares a bare bash or sh.
 *
 * @param step - The step.
 * @returns True when it does.
 */
function hasScannedShell(step: IStep): boolean {
  return SCANNED_SHELL.test(step.shell ?? '');
}

/**
 * Path relative to the repository root, for messages.
 *
 * @param file - Absolute path.
 * @returns Repo-relative path.
 */
function repoRelative(file: string): string {
  return file.slice(REPO_ROOT.length);
}

/**
 * Whether a job's step-less shell falls back to a bash default.
 *
 * @param runsOn - The job's `runs-on`.
 * @returns Why it may not, or empty when it does.
 */
function runnerProblem(runsOn: unknown): string {
  const labels: readonly unknown[] = Array.isArray(runsOn) ? runsOn : [runsOn];
  if (labels.length > 0 && labels.every(isBashRunnerLabel)) return '';
  const shown = runsOn === undefined ? 'missing' : JSON.stringify(runsOn);
  return `runs-on ${shown} may not default to bash`;
}

/**
 * Whether Scorecard scans one workflow run step.
 *
 * @param step - The step.
 * @param job - Its job.
 * @returns Why it does not, or empty when it does.
 */
function stepProblem(step: IStep, job: IJob): string {
  const shell = step.shell ?? job.defaults?.run?.shell;
  if (shell === undefined) return runnerProblem(job['runs-on']);
  return SCANNED_SHELL.test(shell) ? '' : `shell "${shell}" is not a bare bash or sh`;
}

/**
 * Every run step of a job that Scorecard would skip.
 *
 * @param job - The job.
 * @param where - Location prefix.
 * @returns Located problems.
 */
function jobProblems(job: IJob, where: string): string[] {
  const steps = job.steps ?? [];
  const located = steps.map((step, index) => {
    const why = step.run === undefined ? '' : stepProblem(step, job);
    return why && `${where}.steps[${String(index)}]: ${why}`;
  });
  return located.filter(Boolean);
}

/**
 * Whether a workflow-level default shell runs bash or sh.
 *
 * @param doc - The workflow.
 * @param where - Location prefix.
 * @returns Located problems.
 */
function workflowDefaultProblems(doc: IWorkflow, where: string): string[] {
  const shell = doc.defaults?.run?.shell;
  if (shell === undefined || BASH_FAMILY_SHELL.test(shell)) return [];
  return [`${where} defaults.run.shell "${shell}" is not bash or sh`];
}

/**
 * Every shell-policy problem in one workflow.
 *
 * @param doc - The workflow.
 * @param where - Location prefix.
 * @returns Located problems.
 */
function workflowProblems(doc: IWorkflow, where: string): string[] {
  const jobs = Object.entries(doc.jobs ?? {});
  const stepIssues = jobs.flatMap(([key, job]) => jobProblems(job, `${where} jobs.${key}`));
  const defaultIssues = workflowDefaultProblems(doc, where);
  return [...defaultIssues, ...stepIssues];
}

/**
 * Every composite-action run step not on bash or sh.
 *
 * @param doc - The action.
 * @param where - Location prefix.
 * @returns Located problems.
 */
function compositeProblems(doc: IComposite, where: string): string[] {
  const steps = doc.runs?.steps ?? [];
  const runSteps = steps.filter(step => step.run !== undefined);
  const offPolicy = runSteps.filter(step => !hasScannedShell(step));
  return offPolicy.map(step => `${where}: shell "${String(step.shell)}"`);
}

/**
 * Every shell-policy problem across the repo's workflows.
 *
 * @returns Located problems.
 */
function repoWorkflowProblems(): string[] {
  return workflowFiles().flatMap(file => {
    const doc = loadYaml(file) as IWorkflow;
    const where = repoRelative(file);
    return workflowProblems(doc, where);
  });
}

/**
 * Every shell-policy problem across the repo's composite actions.
 *
 * @param files - The actions' metadata files.
 * @returns Located problems.
 */
function repoCompositeProblems(files: readonly string[]): string[] {
  return files.flatMap(file => {
    const doc = loadYaml(file) as IComposite;
    const where = repoRelative(file);
    return compositeProblems(doc, where);
  });
}

/**
 * Count the run steps across the repo's workflows.
 *
 * @returns Number of steps with `run:`.
 */
function countWorkflowRunSteps(): number {
  const docs = workflowFiles().map(file => loadYaml(file) as IWorkflow);
  const jobs = docs.flatMap(doc => Object.values(doc.jobs ?? {}));
  return jobs.flatMap(job => job.steps ?? []).filter(step => step.run !== undefined).length;
}

/**
 * A one-job workflow.
 *
 * @param job - The job.
 * @param defaults - Workflow-level defaults.
 * @returns The workflow.
 */
function oneJob(job: IJob, defaults?: IRunDefaults): IWorkflow {
  return { defaults, jobs: { job } };
}

const UBUNTU = 'ubuntu-latest';
const NPM_STEP: IStep = { run: 'npm ci' };

const POLICY_CASES: readonly IPolicyCase[] = [
  {
    name: 'unset shell on ubuntu',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [NPM_STEP] }),
    isAccepted: true,
  },
  {
    name: 'unset shell on macos',
    doc: oneJob({ 'runs-on': 'macos-latest', steps: [NPM_STEP] }),
    isAccepted: true,
  },
  {
    name: 'unset shell on a label list',
    doc: oneJob({ 'runs-on': ['self-hosted', 'linux'], steps: [NPM_STEP] }),
    isAccepted: true,
  },
  {
    name: 'step shell bash',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [{ ...NPM_STEP, shell: 'bash' }] }),
    isAccepted: true,
  },
  {
    name: 'job default sh',
    doc: oneJob({ 'runs-on': UBUNTU, defaults: { run: { shell: 'sh' } }, steps: [NPM_STEP] }),
    isAccepted: true,
  },
  {
    name: 'workflow default bash with arguments',
    doc: oneJob(
      { 'runs-on': UBUNTU, steps: [NPM_STEP] },
      { run: { shell: 'bash --noprofile --norc -euo pipefail {0}' } },
    ),
    isAccepted: true,
  },
  { name: 'reusable-workflow call', doc: oneJob({}), isAccepted: true },
  {
    name: 'step shell pwsh',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [{ ...NPM_STEP, shell: 'pwsh' }] }),
    isAccepted: false,
  },
  {
    name: 'step shell bash with arguments',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [{ ...NPM_STEP, shell: 'bash -e {0}' }] }),
    isAccepted: false,
  },
  {
    name: 'step shell by path',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [{ ...NPM_STEP, shell: '/bin/bash -e {0}' }] }),
    isAccepted: false,
  },
  {
    name: 'job default with arguments',
    doc: oneJob({
      'runs-on': UBUNTU,
      defaults: { run: { shell: 'bash -e {0}' } },
      steps: [NPM_STEP],
    }),
    isAccepted: false,
  },
  {
    name: 'workflow default pwsh',
    doc: oneJob({ 'runs-on': UBUNTU, steps: [NPM_STEP] }, { run: { shell: 'pwsh' } }),
    isAccepted: false,
  },
  {
    name: 'unset shell on windows',
    doc: oneJob({ 'runs-on': 'windows-latest', steps: [NPM_STEP] }),
    isAccepted: false,
  },
  {
    name: 'unset shell on an expression runner',
    doc: oneJob({ 'runs-on': '${{ matrix.os }}', steps: [NPM_STEP] }),
    isAccepted: false,
  },
  { name: 'unset shell with no runs-on', doc: oneJob({ steps: [NPM_STEP] }), isAccepted: false },
];

describe('Workflow shell policy', () => {
  it('[SHP-1] every workflow run step is one Scorecard scans', () => {
    const problems = repoWorkflowProblems();
    const runSteps = countWorkflowRunSteps();
    expect(problems).toEqual([]);
    expect(runSteps).toBeGreaterThan(0);
  });

  it('[SHP-2] every composite-action run step declares bash or sh', () => {
    const files = actionFiles();
    const problems = repoCompositeProblems(files);
    expect(files.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it('[SHP-3] rejects a composite-action step on another shell', () => {
    const doc: IComposite = { runs: { steps: [{ run: 'npm ci', shell: 'pwsh' }] } };
    const problems = compositeProblems(doc, 'action.yml');
    expect(problems).toHaveLength(1);
  });

  it.each(POLICY_CASES)('[SHP-4] $name → accepted: $isAccepted', ({ doc, isAccepted }) => {
    const problems = workflowProblems(doc, 'wf.yml');
    expect(problems.length === 0).toBe(isAccepted);
  });

  it('[SHP-5] names the runner when an unset shell would not default to bash', () => {
    const why = runnerProblem('windows-latest');
    expect(why).toMatch(/windows-latest/);
  });
});
