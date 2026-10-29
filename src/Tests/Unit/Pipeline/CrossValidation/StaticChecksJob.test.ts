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
 *
 * <p>It also pins how the foreground gates keep going after one fails. A
 * `ready` step closes setup; every gate after it runs under
 * `!cancelled() && steps.ready.outcome == 'success' && (<trigger>)`, so one
 * failure no longer skips the rest and a single run reports every failing
 * gate. The conditions are run through the GitHub `if:` evaluator, not
 * string-matched, so a gate added without the guard fails here. A condition
 * may read only steps declared above it: GitHub reads a later or missing
 * step's outcome as empty, so such a gate would never run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type { IGhaContext, IGhaStatus, IStepState } from '../../../Helpers/GhaExpression.js';
import { evaluateIf } from '../../../Helpers/GhaExpression.js';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const COMPOSITE_YAML = join(REPO_ROOT, '.github/actions/decoupling-gate/action.yml');

const JOB_KEY = 'static-checks';
const CHANGES_JOB_KEY = 'changes';
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

/** The step that closes setup, pinned whole; it keeps the implicit `success()`. */
const READY_STEP = {
  name: 'Setup complete',
  id: 'ready',
  run: 'echo "Setup complete; every gate below runs even if an earlier one fails."',
};

/** The setup step that copies the tests config every type check reads. */
const TESTS_CONFIG_COPY = 'npx ncp src/Tests/.tests-config.tpl.cjs src/Tests/.tests-config.cjs';

/** Status after an earlier step failed: `success()` is false, the run goes on. */
const AFTER_A_FAILURE: IGhaStatus = { success: false, failure: true, cancelled: false };

/** Status once the run is cancelled. */
const CANCELLED: IGhaStatus = { success: false, failure: false, cancelled: true };

/** `[why, status, outcome of every step with an id]` rows in which no gate may run. */
const STOPPED = [
  ['setup did not finish', AFTER_A_FAILURE, 'skipped'],
  ['the run was cancelled', CANCELLED, 'success'],
] as const;

/** `[gate, the step it consumes]`: the gate must skip unless that step succeeded. */
const CHAINED = [
  ['Lychee link checker', 'lychee_tree'],
  ['Install mkdocs + plugins', 'python'],
  ['mkdocs build --strict (catches dead links / undefined refs)', 'mkdocs_deps'],
] as const;

/** A `steps.<id>` reference in an `if:`. */
const STEP_REFERENCE = /\bsteps\.(?<id>[\w-]+)/g;

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
  readonly id?: string;
  readonly if?: unknown;
  readonly uses?: string;
  readonly run?: string;
  readonly shell?: unknown;
  readonly background?: unknown;
  readonly env?: Readonly<Record<string, string>>;
}

interface IJob {
  readonly outputs?: Readonly<Record<string, string>>;
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

/**
 * The foreground gates: every step after `ready` that is neither a
 * background step nor the closing `wait-all`.
 *
 * @returns The gates, in order.
 */
function gates(): readonly IStep[] {
  const all = steps();
  const readyAt = all.findIndex(step => step.id === READY_STEP.id);
  const after = all.slice(readyAt + 1);
  return after.filter(step => step.background !== true && !('wait-all' in step));
}

/**
 * A step's `if:`; empty, and so rejected by the evaluator, when it has none.
 *
 * @param step - The step.
 * @returns The condition text.
 */
function conditionOf(step: IStep): string {
  return typeof step.if === 'string' ? step.if : '';
}

/**
 * The step ids a step's `if:` reads.
 *
 * @param step - The step.
 * @returns Each `steps.<id>` it references, in order.
 */
function stepIdsReadBy(step: IStep): readonly string[] {
  const condition = conditionOf(step);
  const references = condition.matchAll(STEP_REFERENCE);
  return Array.from(references, match => match.groups?.id ?? '');
}

/**
 * `<step>: <id>` for each step id a condition reads that no step above it
 * declares.
 *
 * @returns The unresolved references.
 */
function forwardStepReferences(): readonly string[] {
  const all = steps();
  return all.flatMap((step, at) => {
    const declared = all.slice(0, at).map(prior => prior.id);
    const unresolved = stepIdsReadBy(step).filter(id => !declared.includes(id));
    return unresolved.map(id => `${step.name ?? step.uses ?? '?'}: ${id}`);
  });
}

/**
 * Every `changes` output set to `true`, so each gate's trigger fires.
 *
 * @returns Outputs by name.
 */
function allFlagsOn(): Readonly<Record<string, string>> {
  const changes = jobs()[CHANGES_JOB_KEY] ?? {};
  const names = Object.keys(changes.outputs ?? {});
  const rows = names.map(name => [name, 'true'] as const);
  return Object.fromEntries(rows);
}

/**
 * Every step with an `id`, each with one outcome unless overridden.
 *
 * @param outcome - The outcome of every step.
 * @param overrides - Outcomes by step id that differ from it.
 * @returns Step states by id.
 */
function stepStates(
  outcome: string,
  overrides: Readonly<Record<string, string>>,
): Readonly<Record<string, IStepState>> {
  const ids = steps().flatMap(step => (typeof step.id === 'string' ? [step.id] : []));
  const rows = ids.map(id => [id, { outcome: overrides[id] ?? outcome, outputs: {} }] as const);
  return Object.fromEntries(rows);
}

/**
 * The context a gate's `if:` is checked in on a pull request.
 *
 * @param status - The job status at that point.
 * @param outcome - The outcome of every step with an id.
 * @param overrides - Outcomes by step id that differ from it.
 * @returns The context.
 */
function contextFor(
  status: IGhaStatus,
  outcome: string,
  overrides: Readonly<Record<string, string>> = {},
): IGhaContext {
  const changes = { result: 'success', outputs: allFlagsOn() };
  const states = stepStates(outcome, overrides);
  return { needs: { changes }, status, steps: states, github: { event_name: 'pull_request' } };
}

/**
 * Whether a step's `if:` lets it run.
 *
 * @param step - The step.
 * @param context - Where its condition is checked.
 * @returns True when it runs.
 */
function runsIn(step: IStep, context: IGhaContext): boolean {
  const condition = conditionOf(step);
  return evaluateIf(condition, context);
}

/** `[label, step]` rows for every gate, labelled by name or action. */
const GATE_ROWS = gates().map(step => [step.name ?? step.uses ?? '?', step] as const);

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

  it('[SCJ-6] closes setup with `ready`, before every background step and gate', () => {
    const all = steps();
    const readyAt = all.findIndex(step => step.id === READY_STEP.id);
    const installAt = all.findIndex(step => step.uses === SETUP_NODE_DEPS);
    const copyAt = all.findIndex(step => step.run === TESTS_CONFIG_COPY);
    const firstBackgroundAt = all.findIndex(step => step.background === true);
    const setupAts = [installAt, copyAt];
    const isSetupFirst = setupAts.every(at => at >= 0 && at < readyAt);
    expect(all[readyAt]).toStrictEqual(READY_STEP);
    expect(isSetupFirst).toBe(true);
    expect(firstBackgroundAt).toBeGreaterThan(readyAt);
  });

  it.each(GATE_ROWS)('[SCJ-7] %s still runs after an earlier gate failed', (_label, step) => {
    const context = contextFor(AFTER_A_FAILURE, 'success');
    const isRun = runsIn(step, context);
    expect(isRun).toBe(true);
  });

  it.each(STOPPED)('[SCJ-8] no gate runs when %s', (_why, status, outcome) => {
    const context = contextFor(status, outcome);
    const all = gates();
    const running = all.filter(step => runsIn(step, context));
    expect(running).toEqual([]);
  });

  it.each(CHAINED)('[SCJ-9] %s skips unless step %s succeeded', (name, producer) => {
    const context = contextFor(AFTER_A_FAILURE, 'success', { [producer]: 'failure' });
    const gate = stepNamed(name);
    const isRun = runsIn(gate, context);
    expect(isRun).toBe(false);
  });

  it('[SCJ-10] every step a condition reads is declared above it', () => {
    const all = steps();
    const references = all.flatMap(stepIdsReadBy);
    const unresolved = forwardStepReferences();
    expect(references.length).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  });
});
