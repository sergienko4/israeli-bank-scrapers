/**
 * Static checks job.
 *
 * <p>`Static checks` in `pr.yml` holds the lint and type steps plus four short
 * repository gates that used to be jobs of their own: Scorecard npm pins, bank
 * integration coverage, decoupling and docs staleness. The four run as
 * `background` steps beside the lint steps, and a closing `wait-all` fails
 * the job when any of them failed. One job instead of five keeps a push
 * inside the account's concurrent-job limit.
 *
 * <p>The background steps share the job's working tree with the foreground
 * steps, so each was checked to write nothing another step reads: Scorecard
 * scans a `git archive` copy in a temp directory, decoupling writes its
 * ignored snapshots and a sibling `../base` worktree, and the other two only
 * read. That review holds for this set only, so the set is pinned here, and
 * adding a background step means repeating it. Decoupling must never share a
 * job with the build, whose guardrails hash `lib/`, or with the memory gate,
 * which adds the same `../base` worktree.
 *
 * <p>Scorecard and docs staleness have their own suites
 * (`ScorecardNpmPinGate`, `DocsStalenessGate`); this one pins the two moved
 * gates that had none, the background set, and the decoupling composite.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const COMPOSITE_YAML = join(REPO_ROOT, '.github/actions/decoupling-gate/action.yml');

const JOB_KEY = 'static-checks';
const DECOUPLING_ACTION = '$/.github/actions/decoupling-gate';
const SETUP_NODE_DEPS = '$/.github/actions/setup-node-deps';
const BUILD_PACKAGE = '$/.github/actions/build-package';
const WORKTREE_ADD = 'git worktree add';

const FULL_SUITE = "needs.changes.outputs.full_suite == 'true'";
const METRICS = "needs.changes.outputs.metrics == 'true'";
const CI_SCRIPTS = "needs.changes.outputs.ci_scripts == 'true'";

/** The bank integration coverage gate, pinned whole. */
const BANK_STEP = {
  name: 'Bank integration coverage gate',
  if: FULL_SUITE,
  background: true,
  'timeout-minutes': 5,
  run: 'npm run lint:bank-coverage',
};

/** The decoupling gate, pinned whole; its threshold reaches the composite as step env. */
const DECOUPLING_STEP = {
  name: 'Decoupling',
  if: `${FULL_SUITE} || ${METRICS} || ${CI_SCRIPTS}`,
  background: true,
  'timeout-minutes': 15,
  uses: DECOUPLING_ACTION,
  env: { THRESHOLD_PCT: '10' },
};

/** The background steps, in order. Adding one means reviewing it for shared writes. */
const BACKGROUND_STEP_NAMES = [
  'npm commands are pinned as Scorecard reads them',
  BANK_STEP.name,
  DECOUPLING_STEP.name,
  'Docs staleness canary',
];

/** The job's last step, where a failed background step fails the job. */
const WAIT_ALL_STEP = { name: 'Wait for the background gates', 'wait-all': null };

/** The decoupling composite's steps, in order. */
const COMPOSITE_STEP_NAMES = [
  'Measure this PR',
  'Check out the merge base',
  'Measure the merge base',
  'Compare against the merge base',
  'Append the full decoupling matrix',
];

/** The composite's verdict step, pinned whole. */
const COMPARE_STEP = {
  name: 'Compare against the merge base',
  env: {
    BASE_SNAPSHOT: 'scripts/decoupling-metrics/snapshots/base.json',
    HEAD_SNAPSHOT: 'scripts/decoupling-metrics/snapshots/head.json',
  },
  shell: 'bash',
  run: 'bash .github/scripts/ci/decoupling-compare.sh',
};

interface IStep {
  readonly name?: string;
  readonly if?: unknown;
  readonly uses?: string;
  readonly run?: string;
  readonly shell?: unknown;
  readonly background?: unknown;
  readonly env?: Readonly<Record<string, string>>;
}

interface IJob {
  readonly steps?: readonly IStep[];
}

interface IWorkflow {
  readonly jobs: Readonly<Record<string, IJob>>;
}

interface IComposite {
  readonly runs: { readonly using: string; readonly steps: readonly IStep[] };
}

/**
 * Every job of the pull-request workflow.
 *
 * @returns Jobs by key.
 */
function jobs(): Readonly<Record<string, IJob>> {
  const text = readFileSync(PR_YAML, 'utf8');
  return (parse(text) as IWorkflow).jobs;
}

/**
 * The job's steps.
 *
 * @returns Steps in order, or none when the job is missing.
 */
function steps(): readonly IStep[] {
  const job = jobs()[JOB_KEY] ?? {};
  return job.steps ?? [];
}

/**
 * The job's step with a given name.
 *
 * @param name - Exact `name:` of the step.
 * @returns The step, or an empty step when it is missing.
 */
function stepNamed(name: string): IStep {
  return steps().find(step => step.name === name) ?? {};
}

/**
 * The top-level `||` terms of a step's `if:`.
 *
 * @param step - The step.
 * @returns The terms; none when the step has no condition.
 */
function orTerms(step: IStep): readonly string[] {
  return typeof step.if === 'string' ? step.if.split(' || ') : [];
}

/**
 * The decoupling composite.
 *
 * @returns The parsed `action.yml`.
 */
function composite(): IComposite {
  const text = readFileSync(COMPOSITE_YAML, 'utf8');
  return parse(text) as IComposite;
}

/**
 * Whether a job runs the build or adds a `git worktree`.
 *
 * @param job - The job.
 * @returns True when any step does either.
 */
function buildsOrAddsWorktree(job: IJob): boolean {
  const all = job.steps ?? [];
  return all.some(step => step.uses === BUILD_PACKAGE || (step.run ?? '').includes(WORKTREE_ADD));
}

describe('Static checks job', () => {
  it('[SCJ-1] runs the moved bank coverage and decoupling gates unchanged', () => {
    const bank = stepNamed(BANK_STEP.name);
    const decoupling = stepNamed(DECOUPLING_STEP.name);
    expect(bank).toStrictEqual(BANK_STEP);
    expect(decoupling).toStrictEqual(DECOUPLING_STEP);
  });

  it('[SCJ-2] runs exactly the reviewed background steps, closed by one wait-all', () => {
    const all = steps();
    const background = all.filter(step => step.background === true);
    const names = background.map(step => step.name);
    const waits = all.filter(step => 'wait-all' in step || 'wait' in step);
    const last = all.at(-1);
    expect(names).toEqual(BACKGROUND_STEP_NAMES);
    expect(waits).toStrictEqual([WAIT_ALL_STEP]);
    expect(last).toStrictEqual(WAIT_ALL_STEP);
  });

  it.each([BANK_STEP.name, DECOUPLING_STEP.name])(
    '[SCJ-3] installs dependencies before, and whenever, %s runs',
    name => {
      const all = steps();
      const installAt = all.findIndex(step => step.uses === SETUP_NODE_DEPS);
      const gateAt = all.findIndex(step => step.name === name);
      const installTerms = orTerms(all[installAt] ?? {});
      const gateTerms = orTerms(all[gateAt] ?? {});
      const uncovered = gateTerms.filter(term => !installTerms.includes(term));
      expect(installAt).toBeGreaterThanOrEqual(0);
      expect(gateAt).toBeGreaterThan(installAt);
      expect(gateTerms.length).toBeGreaterThan(0);
      expect(uncovered).toEqual([]);
    },
  );

  it('[SCJ-4] the decoupling composite runs its five steps in bash, ending on the verdict', () => {
    const { runs } = composite();
    const names = runs.steps.map(step => step.name);
    const otherShells = runs.steps.filter(step => step.shell !== 'bash');
    const [, , , compare] = runs.steps;
    expect(runs.using).toBe('composite');
    expect(names).toEqual(COMPOSITE_STEP_NAMES);
    expect(otherShells).toEqual([]);
    expect(compare).toStrictEqual(COMPARE_STEP);
  });

  it('[SCJ-5] decoupling shares a job with neither the build nor the memory gate', () => {
    const byKey = jobs();
    const all = Object.values(byKey);
    const holders = all.filter(job => job.steps?.some(step => step.uses === DECOUPLING_ACTION));
    const sharing = holders.filter(buildsOrAddsWorktree);
    expect(holders).toHaveLength(1);
    expect(sharing).toEqual([]);
  });
});
