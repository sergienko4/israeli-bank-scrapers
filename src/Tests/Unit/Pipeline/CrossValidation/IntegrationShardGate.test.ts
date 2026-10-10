/**
 * Integration shard-contract wiring test.
 *
 * <p>The `integration` job in `.github/workflows/pr.yml` splits both
 * integration modes across a Jest `--shard` matrix. Jest hands whole test
 * files to shards, so shards 1..N add up to the full suite only when every
 * shard runs and both mode commands name the same shard of the same N.
 * Each rule below pins one way a later YAML edit could drop part of that
 * union while the job still reports green:
 *
 * <ul>
 *   <li>a shrunk or widened matrix leaves shards unrun or runs extra ones;</li>
 *   <li>fail-fast cancels the sibling shards after the first failure;</li>
 *   <li>a mode command with no shard, a fixed shard, another N or
 *       `--passWithNoTests` runs the wrong slice or passes an empty one;</li>
 *   <li>an `if:` on Mode A can skip it on some shards;</li>
 *   <li>`INTEGRATION_BANK_FILTER` narrows the bank set — it is a local
 *       debugging knob, never a CI input — whether set in the workflow or
 *       named anywhere under `.github/actions` (a lexical scan);</li>
 *   <li>Mode B without `!cancelled()` gets an implicit `success()` and is
 *       skipped after a Mode A failure, and a `steps.setup` reference to a
 *       missing or later step skips it on every run;</li>
 *   <li>`continue-on-error` turns a failing shard green.</li>
 * </ul>
 *
 * <p>Every workflow rule (ISG-1..ISG-9) is also run against mutated copies
 * of the job, and the actions scan (ISG-10) against a planted fixture file,
 * so a check that stopped checking anything fails here instead of passing
 * silently.
 * The comparisons are exact on purpose: an equivalent rewrite (another
 * spelling of the Mode B guard, a `fromJSON` matrix) fails here and must
 * update this file in the same change.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const ACTIONS_DIR = join(REPO_ROOT, '.github/actions');

/** The setup action's metadata, relative to `.github/actions`; must be scanned. */
const SETUP_ACTION_FILE = join('setup-test-runner', 'action.yml');

/** A helper script the leaky-action mutant plants next to the setup action. */
const LEAK_SCRIPT = join('setup-test-runner', 'export-env.sh');

/** YAML key of the sharded job under `jobs:`. */
const JOB_KEY = 'integration';

/** The matrix values; shards 1..N together cover every integration file. */
const SHARDS = [1, 2, 3] as const;

/** The shard argument both modes must pass, so each job runs one slice of each. */
const SHARD_ARG = `--shard=\${{ matrix.shard }}/${String(SHARDS.length)}`;

/** npm script prefix each mode step runs; the `:bank` variant is the CI one. */
const MODES = {
  a: 'test:integration:mode-a',
  b: 'test:integration:mode-b',
} as const;

/** `id:` of the step that installs deps and Camoufox. */
const SETUP_STEP_ID = 'setup';

/** Composite action the setup step must use. */
const SETUP_ACTION = '/.github/actions/setup-test-runner';

/**
 * Mode B's guard. `!cancelled()` replaces the implicit `success()`, so Mode B
 * still runs after Mode A fails; the setup check stops it on a broken runner.
 */
const MODE_B_CONDITION = "${{ !cancelled() && steps.setup.outcome == 'success' }}";

/** Local-only filter that would narrow the integration bank set. */
const FILTER_ENV = 'INTEGRATION_BANK_FILTER';

type ModeKey = keyof typeof MODES;
type Env = Readonly<Record<string, unknown>>;

/** The exact command each mode step must run: same shard, same N. */
const EXPECTED_RUN: Readonly<Record<ModeKey, string>> = {
  a: `npm run ${MODES.a}:bank -- ${SHARD_ARG}`,
  b: `npm run ${MODES.b}:bank -- ${SHARD_ARG}`,
};

interface IStep {
  readonly id?: string;
  readonly if?: unknown;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Env;
  readonly 'continue-on-error'?: unknown;
}

interface IStrategy {
  readonly 'fail-fast'?: unknown;
  readonly matrix?: Readonly<Record<string, unknown>>;
}

interface IJob {
  readonly env?: Env;
  readonly strategy?: IStrategy;
  readonly steps?: readonly IStep[];
  readonly 'continue-on-error'?: unknown;
}

interface IWorkflow {
  readonly env?: Env;
  readonly jobs?: Readonly<Record<string, IJob>>;
}

interface IContractRule {
  readonly id: string;
  readonly name: string;
  readonly holds: (doc: IWorkflow) => boolean;
}

/** Keys a mutant overwrites on its target; an `undefined` value deletes the key. */
type Patch = Readonly<Record<string, unknown>>;

/** Where a mutant applies its patch; `order` swaps the two mode steps. */
type MutantTarget = 'workflow' | 'job' | 'strategy' | 'setup' | 'modeA' | 'modeB' | 'order';

interface IMutant {
  readonly rule: string;
  readonly name: string;
  readonly target: MutantTarget;
  readonly patch: Patch;
}

/**
 * Parse the PR workflow.
 *
 * @returns Parsed workflow document.
 */
function loadPrYaml(): IWorkflow {
  const raw = readFileSync(PR_YAML, 'utf8');
  return parse(raw) as IWorkflow;
}

/**
 * The integration job, or an empty job when the key is missing.
 *
 * @param doc - Parsed workflow.
 * @returns The job definition.
 */
function jobOf(doc: IWorkflow): IJob {
  const jobs = doc.jobs ?? {};
  return jobs[JOB_KEY] ?? {};
}

/**
 * The integration job's steps, in job order.
 *
 * @param doc - Parsed workflow.
 * @returns Steps; empty when the job or its steps are missing.
 */
function stepsOf(doc: IWorkflow): readonly IStep[] {
  const job = jobOf(doc);
  return job.steps ?? [];
}

/**
 * Whether a step runs Mode A's script.
 *
 * @param step - Step to classify.
 * @returns True when `run` invokes the Mode A script.
 */
function isModeAStep(step: IStep): boolean {
  return step.run?.includes(MODES.a) === true;
}

/**
 * Whether a step runs Mode B's script.
 *
 * @param step - Step to classify.
 * @returns True when `run` invokes the Mode B script.
 */
function isModeBStep(step: IStep): boolean {
  return step.run?.includes(MODES.b) === true;
}

/** Step predicate per mode. */
const IS_MODE_STEP: Readonly<Record<ModeKey, (step: IStep) => boolean>> = {
  a: isModeAStep,
  b: isModeBStep,
};

/**
 * Whether a step is the setup step Mode B's condition reads.
 *
 * @param step - Step to classify.
 * @returns True for `id: setup` using the setup-test-runner action.
 */
function isSetupStep(step: IStep): boolean {
  return step.id === SETUP_STEP_ID && step.uses?.endsWith(SETUP_ACTION) === true;
}

/**
 * Every integration step that runs one mode.
 *
 * @param doc - Parsed workflow.
 * @param mode - Which integration mode.
 * @returns Matching steps, in job order.
 */
function modeSteps(doc: IWorkflow, mode: ModeKey): readonly IStep[] {
  const isMode = IS_MODE_STEP[mode];
  const steps = stepsOf(doc);
  return steps.filter(isMode);
}

/**
 * Whether exactly one step runs the mode, with the shared shard argument.
 *
 * @param doc - Parsed workflow.
 * @param mode - Which integration mode.
 * @returns True when the mode runs once, on this job's shard of N.
 */
function runsOwnShard(doc: IWorkflow, mode: ModeKey): boolean {
  const steps = modeSteps(doc, mode);
  const runs = steps.map((step): unknown => step.run);
  return isDeepStrictEqual(runs, [EXPECTED_RUN[mode]]);
}

/**
 * ISG-1: the matrix has one axis, `shard`, listing 1..N.
 *
 * @param doc - Parsed workflow.
 * @returns True when the matrix is exactly `{ shard: [1..N] }`.
 */
function hasShardMatrix(doc: IWorkflow): boolean {
  const job = jobOf(doc);
  return isDeepStrictEqual(job.strategy?.matrix, { shard: SHARDS });
}

/**
 * ISG-2: one failing shard does not cancel its siblings.
 *
 * @param doc - Parsed workflow.
 * @returns True when `fail-fast` is explicitly false.
 */
function keepsFailFastOff(doc: IWorkflow): boolean {
  const job = jobOf(doc);
  return job.strategy?.['fail-fast'] === false;
}

/**
 * ISG-3: Mode A runs once, on this job's shard.
 *
 * @param doc - Parsed workflow.
 * @returns True when the Mode A command is exact.
 */
function modeARunsOwnShard(doc: IWorkflow): boolean {
  return runsOwnShard(doc, 'a');
}

/**
 * ISG-4: Mode B runs once, on the same shard as Mode A.
 *
 * @param doc - Parsed workflow.
 * @returns True when the Mode B command is exact.
 */
function modeBRunsOwnShard(doc: IWorkflow): boolean {
  return runsOwnShard(doc, 'b');
}

/**
 * ISG-9: Mode A has no `if:`, so no shard can skip it.
 *
 * @param doc - Parsed workflow.
 * @returns True when the only Mode A step carries no condition.
 */
function modeARunsUnconditionally(doc: IWorkflow): boolean {
  const steps = modeSteps(doc, 'a');
  const conditions = steps.map((step): unknown => step.if);
  return isDeepStrictEqual(conditions, [undefined]);
}

/**
 * ISG-5: the bank filter is absent from workflow env and the whole job.
 *
 * @param doc - Parsed workflow.
 * @returns True when nothing in scope names the filter.
 */
function isFilterFree(doc: IWorkflow): boolean {
  const workflowEnv = Object.keys(doc.env ?? {});
  const job = jobOf(doc);
  const jobText = JSON.stringify(job);
  return !workflowEnv.includes(FILTER_ENV) && !jobText.includes(FILTER_ENV);
}

/**
 * ISG-6: Mode B carries the guard that lets it run after Mode A fails.
 *
 * @param doc - Parsed workflow.
 * @returns True when the only Mode B step has exactly that condition.
 */
function modeBSurvivesModeAFailure(doc: IWorkflow): boolean {
  const steps = modeSteps(doc, 'b');
  const conditions = steps.map((step): unknown => step.if);
  return isDeepStrictEqual(conditions, [MODE_B_CONDITION]);
}

/**
 * ISG-7: setup precedes Mode A, and Mode A precedes Mode B.
 *
 * @param doc - Parsed workflow.
 * @returns True for setup → Mode A → Mode B, each present.
 */
function ordersSetupThenModes(doc: IWorkflow): boolean {
  const steps = stepsOf(doc);
  const setup = steps.findIndex(isSetupStep);
  const modeA = steps.findIndex(isModeAStep);
  const modeB = steps.findIndex(isModeBStep);
  return setup >= 0 && setup < modeA && modeA < modeB;
}

/**
 * ISG-8: neither the job nor any step swallows a failure.
 *
 * @param doc - Parsed workflow.
 * @returns True when no `continue-on-error` is enabled.
 */
function failsLoudly(doc: IWorkflow): boolean {
  const job = jobOf(doc);
  const flags = [job, ...stepsOf(doc)].map((item): unknown => item['continue-on-error']);
  return flags.every((flag): boolean => flag === undefined || flag === false);
}

const RULES: readonly IContractRule[] = [
  { id: 'ISG-1', name: 'Matrix_ShardAxisOnly_ShouldListShardsOneToN', holds: hasShardMatrix },
  { id: 'ISG-2', name: 'Strategy_ShardFails_ShouldNotCancelSiblings', holds: keepsFailFastOff },
  { id: 'ISG-3', name: 'ModeA_Run_ShouldTakeMatrixShardOfN', holds: modeARunsOwnShard },
  { id: 'ISG-4', name: 'ModeB_Run_ShouldTakeSameShardAsModeA', holds: modeBRunsOwnShard },
  { id: 'ISG-5', name: 'Env_BankFilter_ShouldStayUnset', holds: isFilterFree },
  { id: 'ISG-6', name: 'ModeB_AfterModeAFailure_ShouldStillRun', holds: modeBSurvivesModeAFailure },
  { id: 'ISG-7', name: 'Steps_Order_ShouldBeSetupThenModeAThenModeB', holds: ordersSetupThenModes },
  { id: 'ISG-8', name: 'Job_FailingShard_ShouldFailTheJob', holds: failsLoudly },
  { id: 'ISG-9', name: 'ModeA_Condition_ShouldBeAbsent', holds: modeARunsUnconditionally },
];

/**
 * Shallow-merge a patch, dropping keys whose patched value is `undefined`,
 * the shape YAML parsing gives once the key is deleted from the file.
 *
 * @param base - Object to copy.
 * @param patch - Keys to overwrite or delete.
 * @returns The merged copy; `base` is untouched.
 */
function applyPatch<T extends object>(base: T, patch: Patch): T {
  const merged = { ...base, ...patch };
  const entries = Object.entries(merged);
  const kept = entries.filter(([, value]): boolean => value !== undefined);
  return Object.fromEntries(kept) as T;
}

/**
 * Copy of the workflow with keys overwritten at the top level.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchWorkflow(doc: IWorkflow, patch: Patch): IWorkflow {
  return applyPatch(doc, patch);
}

/**
 * Copy of the workflow with keys overwritten on the integration job.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchJob(doc: IWorkflow, patch: Patch): IWorkflow {
  const current = jobOf(doc);
  const job = applyPatch(current, patch);
  return { ...doc, jobs: { ...doc.jobs, [JOB_KEY]: job } };
}

/**
 * Copy of the workflow with keys overwritten on the job's strategy.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchStrategy(doc: IWorkflow, patch: Patch): IWorkflow {
  const job = jobOf(doc);
  const strategy = applyPatch(job.strategy ?? {}, patch);
  return patchJob(doc, { strategy });
}

/**
 * Copy of the workflow with keys overwritten on every matching step.
 *
 * @param doc - Parsed workflow.
 * @param isTarget - Selects the steps to patch.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchSteps(doc: IWorkflow, isTarget: (step: IStep) => boolean, patch: Patch): IWorkflow {
  const steps = stepsOf(doc);
  const patched = steps.map((step): IStep => (isTarget(step) ? applyPatch(step, patch) : step));
  return patchJob(doc, { steps: patched });
}

/**
 * Copy of the workflow with the setup step patched.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchSetup(doc: IWorkflow, patch: Patch): IWorkflow {
  return patchSteps(doc, isSetupStep, patch);
}

/**
 * Copy of the workflow with the Mode A step patched.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchModeA(doc: IWorkflow, patch: Patch): IWorkflow {
  return patchSteps(doc, isModeAStep, patch);
}

/**
 * Copy of the workflow with the Mode B step patched.
 *
 * @param doc - Parsed workflow.
 * @param patch - Keys to overwrite.
 * @returns The mutated workflow; `doc` is untouched.
 */
function patchModeB(doc: IWorkflow, patch: Patch): IWorkflow {
  return patchSteps(doc, isModeBStep, patch);
}

/**
 * Copy of the workflow with the Mode A and Mode B steps swapped.
 *
 * @param doc - Parsed workflow.
 * @returns The mutated workflow; `doc` is untouched.
 */
function swapModes(doc: IWorkflow): IWorkflow {
  const steps = stepsOf(doc);
  const modeA = steps.findIndex(isModeAStep);
  const modeB = steps.findIndex(isModeBStep);
  const swapped = [...steps];
  swapped[modeA] = steps[modeB];
  swapped[modeB] = steps[modeA];
  return patchJob(doc, { steps: swapped });
}

/** Mutator per target; `order` ignores the patch. */
const MUTATORS: Readonly<Record<MutantTarget, (doc: IWorkflow, patch: Patch) => IWorkflow>> = {
  workflow: patchWorkflow,
  job: patchJob,
  strategy: patchStrategy,
  setup: patchSetup,
  modeA: patchModeA,
  modeB: patchModeB,
  order: swapModes,
};

const FILTER = { [FILTER_ENV]: 'amex' } as const;

/** Each a plausible later edit that silently loses coverage; see the file header. */
const MUTANTS: readonly IMutant[] = [
  {
    rule: 'ISG-1',
    name: 'matrix shrunk to two shards',
    target: 'strategy',
    patch: { matrix: { shard: [1, 2] } },
  },
  {
    rule: 'ISG-1',
    name: 'matrix widened by an include entry',
    target: 'strategy',
    patch: { matrix: { shard: SHARDS, include: [{ shard: SHARDS.length + 1 }] } },
  },
  { rule: 'ISG-2', name: 'fail-fast on', target: 'strategy', patch: { 'fail-fast': true } },
  {
    rule: 'ISG-2',
    name: 'fail-fast removed (defaults to true)',
    target: 'strategy',
    patch: { 'fail-fast': undefined },
  },
  {
    rule: 'ISG-3',
    name: 'Mode A without a shard',
    target: 'modeA',
    patch: { run: `npm run ${MODES.a}:bank` },
  },
  {
    rule: 'ISG-3',
    name: 'Mode A pinned to shard 1',
    target: 'modeA',
    patch: { run: `npm run ${MODES.a}:bank -- --shard=1/${String(SHARDS.length)}` },
  },
  {
    rule: 'ISG-3',
    name: 'Mode A passing with no tests',
    target: 'modeA',
    patch: { run: `${EXPECTED_RUN.a} --passWithNoTests` },
  },
  {
    rule: 'ISG-4',
    name: 'Mode B on another shard count',
    target: 'modeB',
    patch: { run: `npm run ${MODES.b}:bank -- --shard=\${{ matrix.shard }}/4` },
  },
  { rule: 'ISG-4', name: 'Mode B command removed', target: 'modeB', patch: { run: undefined } },
  { rule: 'ISG-5', name: 'filter in workflow env', target: 'workflow', patch: { env: FILTER } },
  { rule: 'ISG-5', name: 'filter in job env', target: 'job', patch: { env: FILTER } },
  { rule: 'ISG-5', name: 'filter in Mode B step env', target: 'modeB', patch: { env: FILTER } },
  {
    rule: 'ISG-5',
    name: 'filter inlined into the Mode A command',
    target: 'modeA',
    patch: { run: `${FILTER_ENV}=amex ${EXPECTED_RUN.a}` },
  },
  {
    rule: 'ISG-6',
    name: 'Mode B condition removed (implicit success())',
    target: 'modeB',
    patch: { if: undefined },
  },
  { rule: 'ISG-6', name: 'Mode B gated on success()', target: 'modeB', patch: { if: 'success()' } },
  {
    rule: 'ISG-6',
    name: 'Mode B condition without !cancelled()',
    target: 'modeB',
    patch: { if: "${{ steps.setup.outcome == 'success' }}" },
  },
  { rule: 'ISG-7', name: 'setup step id renamed', target: 'setup', patch: { id: 'runner' } },
  { rule: 'ISG-7', name: 'Mode B moved before Mode A', target: 'order', patch: {} },
  {
    rule: 'ISG-8',
    name: 'job continue-on-error',
    target: 'job',
    patch: { 'continue-on-error': true },
  },
  {
    rule: 'ISG-8',
    name: 'Mode A continue-on-error',
    target: 'modeA',
    patch: { 'continue-on-error': true },
  },
  {
    rule: 'ISG-9',
    name: 'Mode A skipped on one shard',
    target: 'modeA',
    patch: { if: 'matrix.shard != 2' },
  },
];

/**
 * Apply one mutant to a parsed workflow.
 *
 * @param doc - Parsed workflow.
 * @param mutant - The edit to apply.
 * @returns The mutated workflow; `doc` is untouched.
 */
function applyMutant(doc: IWorkflow, mutant: IMutant): IWorkflow {
  const mutate = MUTATORS[mutant.target];
  return mutate(doc, mutant.patch);
}

/**
 * Find a rule by id.
 *
 * @param id - Rule id, e.g. `ISG-1`.
 * @returns The rule; throws when no rule has that id.
 */
function ruleById(id: string): IContractRule {
  const rule = RULES.find((candidate): boolean => candidate.id === id);
  if (rule === undefined) throw new ReferenceError(`no contract rule ${id}`);
  return rule;
}

/**
 * Whether a path under a directory is a regular file.
 *
 * @param root - Directory the entry is relative to.
 * @param entry - Relative path.
 * @returns True for a file, false for a directory.
 */
function isFileAt(root: string, entry: string): boolean {
  const path = join(root, entry);
  const stats = statSync(path);
  return stats.isFile();
}

/**
 * Every file under a directory, at any depth.
 *
 * @param root - Directory to walk.
 * @returns Paths relative to `root`, directories excluded.
 */
function filesUnder(root: string): readonly string[] {
  const entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
  return entries.filter((entry): boolean => isFileAt(root, entry));
}

/**
 * Whether a file's text names the bank filter.
 *
 * @param root - Directory the file is relative to.
 * @param file - Relative path.
 * @returns True when the file mentions the filter.
 */
function namesFilterAt(root: string, file: string): boolean {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  return text.includes(FILTER_ENV);
}

/**
 * Files under a directory whose text names the bank filter.
 *
 * <p>Scans every file, not only `action.yml`, so a helper script that
 * appends the filter to `$GITHUB_ENV` is caught too.
 *
 * @param root - Directory to scan.
 * @returns Offending paths relative to `root`; empty when none.
 */
function filesNamingFilter(root: string): readonly string[] {
  const files = filesUnder(root);
  return files.filter((file): boolean => namesFilterAt(root, file));
}

/**
 * Write a file under a directory, creating its parents.
 *
 * @param root - Directory to write under.
 * @param file - Relative path.
 * @param text - File contents.
 * @returns The absolute path written.
 */
function writeAt(root: string, file: string, text: string): string {
  const path = join(root, file);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * A throwaway actions directory holding a helper script that names the
 * filter. The fixture action never runs it; the scan is lexical.
 *
 * @returns The directory; the caller removes it.
 */
function makeLeakyActionsDir(): string {
  const temp = tmpdir();
  const prefix = join(temp, 'isg-actions-');
  const root = mkdtempSync(prefix);
  writeAt(root, SETUP_ACTION_FILE, 'runs:\n  using: composite\n');
  writeAt(root, LEAK_SCRIPT, `echo "${FILTER_ENV}=amex" >> "$GITHUB_ENV"\n`);
  return root;
}

describe('IntegrationShardGate', () => {
  it.each(RULES)('[$id] IntegrationJob_$name', ({ holds }) => {
    const doc = loadPrYaml();
    const isHeld = holds(doc);
    expect(isHeld).toBe(true);
  });

  it.each(MUTANTS)('[$rule] Mutant_ShouldBeRejected: $name', mutant => {
    const doc = loadPrYaml();
    const mutated = applyMutant(doc, mutant);
    const rule = ruleById(mutant.rule);
    const isHeldOnReal = rule.holds(doc);
    const isHeldOnMutant = rule.holds(mutated);
    expect(isHeldOnReal).toBe(true);
    expect(isHeldOnMutant).toBe(false);
  });

  it('[ISG-10] CompositeActions_BankFilter_ShouldNotBeExported', () => {
    const scanned = filesUnder(ACTIONS_DIR);
    const leaking = filesNamingFilter(ACTIONS_DIR);
    expect(scanned).toContain(SETUP_ACTION_FILE);
    expect(leaking).toEqual([]);
  });

  it('[ISG-10] Mutant_ShouldBeRejected: helper script exporting the filter', () => {
    const root = makeLeakyActionsDir();
    try {
      const leaking = filesNamingFilter(root);
      expect(leaking).toEqual([LEAK_SCRIPT]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('[ISG-11] Mutants_EveryWorkflowRule_ShouldHaveAtLeastOne', () => {
    const covered = new Set(MUTANTS.map((mutant): string => mutant.rule));
    const uncovered = RULES.filter((rule): boolean => !covered.has(rule.id));
    expect(uncovered).toEqual([]);
  });
});
