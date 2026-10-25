/**
 * Push concurrency bound.
 *
 * <p>GitHub Free runs at most 20 jobs at once across the account. One push to
 * a PR must need at most 18 of them, and an `opened` or `reopened` event at
 * most 19, so at least one stays free for overlap. A push peaks once `changes`
 * ends: the `pr.yml` jobs that need only `changes` (one runner per matrix
 * leg) plus what the jobs that wait for them add over the runners they free,
 * every job of the other workflows the push starts, and the runs GitHub
 * starts outside this repo's YAML. Once `Validate` passes and a reviewer
 * approves, the E2E-real legs start beside whatever is still running. Any
 * change to those sets must change this suite, so the bound is re-checked by
 * whoever adds a job.
 *
 * Rules:
 *   PCB-1  the jobs that need only `changes` are exactly the modelled table;
 *          with what the later jobs add, `pr.yml` holds at most 12 runners
 *          before `Validate`
 *   PCB-2  before `Validate`, only the modelled jobs start later; grouped by
 *          the level-1 jobs they wait for, the groups wait for disjoint jobs
 *          and each adds exactly the modelled runners over them
 *   PCB-3  the other workflows a PR event starts, their activity types and
 *          their runners are exactly the modelled set
 *   PCB-4  a push peaks at ≤ 18 runners, an open event at ≤ 19; `changes`
 *          and `Validate` take one runner each
 *   PCB-5  the two open-event jobs never run on the same PR
 *   PCB-6  every workflow a PR push or edit starts cancels the run it
 *          supersedes, except the path-filtered zizmor scan
 *   PCB-7  after `Validate`, the E2E-real legs and the runs that may still be
 *          going beside them need ≤ 18 runners; short runs measured to end
 *          before `Validate` are left out
 *
 * <p>Which runs a cancel group joins is WorkflowConcurrencyGate's (WCG-2).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows');

const PR_YAML = 'pr.yml';
const ROOT_JOB_KEY = 'changes';
const VALIDATE_JOB_KEY = 'validate';

/** The account's concurrent-job limit (GitHub Free) less a margin of 2. */
const PUSH_BOUND = 18;

/** The most runners `pr.yml` may hold at once between `changes` and `Validate`. */
const LEVEL_1_CAP = 12;

/**
 * Runs GitHub starts on each push outside this repo's YAML, one job each:
 * Copilot Code Review and GitHub Advanced Security's Code scanning AI
 * findings (`event: dynamic`).
 */
const DYNAMIC_RUNS = 2;

/** `pr.yml` jobs that need only `changes`, with the runners each starts. */
const LEVEL_1_RUNNERS = {
  'static-checks': 1,
  'portability-macos': 1,
  'unit-tests': 3,
  'package-factory': 1,
  'browser-stack': 1,
  'dependency-review': 1,
};

/** `pr.yml` jobs that start after level 1 and before `Validate`, with their needs. */
const LATE_JOBS = {
  sonarcloud: ['changes', 'unit-tests'],
  'e2e-mocked': ['changes', 'browser-stack'],
  integration: ['changes', 'browser-stack'],
};

/**
 * Runners each group of late jobs adds over the level-1 jobs it waits for,
 * keyed by those jobs: Sonar's 1 waits for the 3 Unit tests legs, and E2E
 * mocked's 1 plus Integration's 3 wait for the 1-runner Browser stack contract.
 */
const LATE_EXTRA = { 'unit-tests': 0, 'browser-stack': 3 };

/** The `pr.yml` jobs that open and close the level-1 stage, one runner each. */
const STAGE_RUNNERS = { [ROOT_JOB_KEY]: 1, [VALIDATE_JOB_KEY]: 1 };

const PR_TRIGGERS = ['pull_request', 'pull_request_target'];

/** The activity types of a PR trigger without `types:`. */
const DEFAULT_TYPES = ['opened', 'reopened', 'synchronize'];
const PUSH_TYPE = 'synchronize';
const EDIT_TYPE = 'edited';
const OPEN_TYPES = ['opened', 'reopened'];

/** Every workflow other than `pr.yml` that a PR event starts. */
const SIBLINGS = {
  'cache-cleanup.yml': { types: ['closed'], runners: { cleanup: 1 } },
  'codeql.yml': { types: DEFAULT_TYPES, runners: { analyze: 1 } },
  'dependabot-auto-merge.yml': { types: ['opened'], runners: { 'auto-merge': 1 } },
  'no-fork-prs.yml': { types: ['opened', 'reopened'], runners: { 'close-fork-pr': 1 } },
  'pr-body-check.yml': {
    types: ['edited', 'opened', 'ready_for_review', 'reopened', 'synchronize'],
    runners: { 'body-check': 1 },
  },
  'pr-title.yml': {
    types: ['edited', 'opened', 'reopened', 'synchronize'],
    runners: { validate: 1 },
  },
  'workflow-security.yml': { types: DEFAULT_TYPES, runners: { zizmor: 1 } },
};

/**
 * The open-event jobs and the conditions that keep them apart: Dependabot
 * opens its PRs from branches of this repo, and the fork job runs only for a
 * PR from another repo.
 */
const OPEN_EVENT_IFS = {
  'auto-merge': "github.event.pull_request.user.login == 'dependabot[bot]'",
  'close-fork-pr': 'github.event.pull_request.head.repo.full_name != github.repository',
};

/**
 * Workflows a PR push starts that may run beside the run they supersede. The
 * zizmor scan runs only when workflow or action files change, never on an
 * edit, for about a minute; two of its runs need two pushes inside that
 * minute, which is overlap between pushes and is left to GitHub's queue.
 */
const CANCEL_EXEMPT = ['workflow-security.yml'];

const PREFLIGHT_JOB_KEY = 'dns-preflight';
const GATE_NEEDS = [VALIDATE_JOB_KEY, PREFLIGHT_JOB_KEY];

/**
 * `pr.yml` jobs that start only after `Validate`: the DNS preflight, then per
 * group an approval gate and its E2E-real legs.
 */
const POST_VALIDATE_JOBS = {
  [PREFLIGHT_JOB_KEY]: { needs: [VALIDATE_JOB_KEY], runners: 1 },
  'e2e-real-group-a-gate': { needs: GATE_NEEDS, runners: 1 },
  'e2e-real-group-a': { needs: ['e2e-real-group-a-gate'], runners: 4 },
  'e2e-real-group-b-gate': { needs: GATE_NEEDS, runners: 1 },
  'e2e-real-group-b': { needs: ['e2e-real-group-b-gate'], runners: 2 },
  'e2e-real-group-c-gate': { needs: GATE_NEEDS, runners: 1 },
  'e2e-real-group-c': { needs: ['e2e-real-group-c-gate'], runners: 3 },
  'e2e-real-group-d-gate': { needs: GATE_NEEDS, runners: 1 },
  'e2e-real-group-d': { needs: ['e2e-real-group-d-gate'], runners: 1 },
  'e2e-real-group-e-gate': { needs: GATE_NEEDS, runners: 1 },
  'e2e-real-group-e': { needs: ['e2e-real-group-e-gate'], runners: 3 },
};

/**
 * Push runs (`file#job`) left out beside the E2E-real legs, which wait for
 * `Validate` and a manual approval, because they were measured to end first.
 * Measured
 * on 31 full-suite PR runs (October 2026; 12 ran the path-filtered zizmor
 * scan): `Validate` ended ≥ 381 s after the run started, and each of these
 * ≥ 180 s before it. Timing, not the DAG, keeps them apart, which this suite
 * cannot check; a run that is not listed here is counted.
 */
const ENDS_BEFORE_VALIDATE = [
  'pr.yml#dependency-review',
  'pr-body-check.yml#body-check',
  'pr-title.yml#validate',
  'workflow-security.yml#zizmor',
];

/** Push runs that may still hold a runner when the E2E-real legs start. */
const RUNS_BESIDE_LEGS = { 'pr.yml#sonarcloud': 1, 'codeql.yml#analyze': 1 };

interface IJob {
  readonly needs?: string | readonly string[];
  readonly if?: unknown;
  readonly uses?: string;
  readonly strategy?: { readonly matrix?: unknown };
}

interface IWorkflow {
  readonly on?: unknown;
  readonly concurrency?: { readonly 'cancel-in-progress'?: unknown };
  readonly jobs?: Readonly<Record<string, IJob>>;
}

interface ISibling {
  readonly types: readonly string[];
  readonly runners: Readonly<Record<string, number>>;
}

interface IPostValidateJob {
  readonly needs: readonly string[];
  readonly runners: number;
}

type Jobs = Readonly<Record<string, IJob>>;
type PostValidateJobs = Readonly<Record<string, IPostValidateJob>>;

/**
 * Parse one workflow file.
 *
 * @param file - File name under `.github/workflows`.
 * @returns The parsed document.
 */
function load(file: string): IWorkflow {
  const path = join(WORKFLOWS_DIR, file);
  const text = readFileSync(path, 'utf8');
  return parse(text) as IWorkflow;
}

/**
 * Every workflow file name.
 *
 * @returns The `.yml` / `.yaml` files under `.github/workflows`, sorted.
 */
function workflowFiles(): readonly string[] {
  const names = readdirSync(WORKFLOWS_DIR);
  return names.filter(name => /\.ya?ml$/u.test(name)).sort();
}

/**
 * The jobs of `pr.yml`.
 *
 * @returns Jobs by key.
 */
function prJobs(): Jobs {
  return load(PR_YAML).jobs ?? {};
}

/**
 * A job's `needs`, as a list.
 *
 * @param job - The job.
 * @returns The job keys it waits for.
 */
function needsOf(job: IJob): readonly string[] {
  const needs = job.needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * Whether the runner count models one matrix axis: a literal list.
 *
 * @param axis - `[axis name, values]`.
 * @returns False for `include` / `exclude` and for any non-list value.
 */
function isModelledAxis(axis: [string, unknown]): boolean {
  const [name, values] = axis;
  return name !== 'include' && name !== 'exclude' && Array.isArray(values);
}

/**
 * The runners one job starts: one per matrix leg.
 *
 * @param key - The job key, for the error.
 * @param job - The job.
 * @returns The runner count; throws on a job shape it does not model.
 */
function runnersOf(key: string, job: IJob): number {
  if (job.uses !== undefined) throw new RangeError(`${key}: reusable workflow call`);
  const matrix = job.strategy?.matrix;
  if (matrix === undefined) return 1;
  if (typeof matrix !== 'object' || matrix === null) throw new RangeError(`${key}: dynamic matrix`);
  const axes = Object.entries(matrix);
  if (!axes.every(isModelledAxis)) throw new RangeError(`${key}: unmodelled matrix`);
  return axes.reduce((product, [, values]) => product * (values as unknown[]).length, 1);
}

/**
 * The runners each job starts.
 *
 * @param jobs - Jobs by key.
 * @returns Runner counts by job key.
 */
function runnersByJob(jobs: Jobs): Readonly<Record<string, number>> {
  const rows = Object.entries(jobs).map(([key, job]) => [key, runnersOf(key, job)] as const);
  return Object.fromEntries(rows);
}

/**
 * The runners of the jobs that open and close the level-1 stage.
 *
 * @returns Runner counts of `changes` and `Validate`.
 */
function stageRunners(): Readonly<Record<string, number>> {
  const jobs = prJobs();
  const keys = Object.keys(STAGE_RUNNERS);
  const rows = keys.map(key => [key, runnersOf(key, jobs[key] ?? {})] as const);
  return Object.fromEntries(rows);
}

/**
 * The total of a runner table.
 *
 * @param runners - Runner counts by job key.
 * @returns Their sum.
 */
function total(runners: Readonly<Record<string, number>>): number {
  return Object.values(runners).reduce((sum, count) => sum + count, 0);
}

/**
 * The `pr.yml` jobs that start once `changes` ends, or at once.
 *
 * @returns Jobs that need nothing but `changes`, other than `changes` itself.
 */
function levelOneJobs(): Jobs {
  const jobs = prJobs();
  const entries = Object.entries(jobs);
  const level1 = entries.filter(
    ([key, job]) => key !== ROOT_JOB_KEY && needsOf(job).every(need => need === ROOT_JOB_KEY),
  );
  return Object.fromEntries(level1);
}

/**
 * Whether a job is `Validate` or waits for it.
 *
 * @param key - The job key.
 * @param jobs - All jobs.
 * @returns True when the job starts only after `Validate` ends.
 */
function reachesValidate(key: string, jobs: Jobs): boolean {
  if (key === VALIDATE_JOB_KEY) return true;
  const job = jobs[key] ?? {};
  return needsOf(job).some(need => reachesValidate(need, jobs));
}

/**
 * The `pr.yml` jobs that start after level 1 and before `Validate`.
 *
 * @returns Their needs by job key.
 */
function lateJobs(): Readonly<Record<string, readonly string[]>> {
  const jobs = prJobs();
  const level1 = levelOneJobs();
  const keys = Object.keys(jobs).filter(
    key => key !== ROOT_JOB_KEY && !(key in level1) && !reachesValidate(key, jobs),
  );
  const rows = keys.map(key => [key, needsOf(jobs[key] ?? {})] as const);
  return Object.fromEntries(rows);
}

/**
 * A workflow's triggers, whatever form `on:` takes.
 *
 * @param on - The `on:` value.
 * @returns Trigger settings by event name.
 */
function triggersOf(on: unknown): Readonly<Record<string, unknown>> {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) {
    const rows = on.map(name => [String(name), null] as const);
    return Object.fromEntries(rows);
  }
  return (on ?? {}) as Readonly<Record<string, unknown>>;
}

/**
 * The activity types one PR trigger fires on.
 *
 * @param settings - The trigger's settings.
 * @returns Its `types:`, or the default types.
 */
function typesOf(settings: unknown): readonly string[] {
  const types = (settings as { readonly types?: unknown } | null)?.types ?? DEFAULT_TYPES;
  const list: unknown[] = Array.isArray(types) ? types : [types];
  return list.map(String);
}

/**
 * The PR activity types a workflow fires on.
 *
 * @param doc - The workflow.
 * @returns The types, sorted; empty when no PR event starts it.
 */
function prTypesOf(doc: IWorkflow): readonly string[] {
  const triggers = triggersOf(doc.on);
  const present = PR_TRIGGERS.filter(name => name in triggers);
  const types = present.flatMap(name => typesOf(triggers[name]));
  return [...new Set(types)].sort();
}

/**
 * Every workflow other than `pr.yml` that a PR event starts.
 *
 * @returns Its PR activity types and runners, by file name.
 */
function siblings(): Readonly<Record<string, ISibling>> {
  const files = workflowFiles().filter(file => file !== PR_YAML);
  const rows = files.map(file => [file, load(file)] as const);
  const started = rows.filter(([, doc]) => prTypesOf(doc).length > 0);
  const modelled = started.map(([file, doc]) => {
    const sibling = { types: prTypesOf(doc), runners: runnersByJob(doc.jobs ?? {}) };
    return [file, sibling] as const;
  });
  return Object.fromEntries(modelled);
}

/**
 * The level-1 jobs a late job waits for, as a group key.
 *
 * @param needs - The late job's needs.
 * @param levelOne - The level-1 jobs.
 * @returns Their keys, sorted and joined with `+`.
 */
function awaitedKey(needs: readonly string[], levelOne: Jobs): string {
  const awaited = needs.filter(need => need in levelOne);
  return awaited.sort().join('+');
}

/**
 * The late jobs, grouped by the level-1 jobs they wait for.
 *
 * @returns Late job keys, by group key.
 */
function lateGroups(): Readonly<Record<string, readonly string[]>> {
  const levelOne = levelOneJobs();
  const lateTable = lateJobs();
  const rows = Object.entries(lateTable);
  return rows.reduce<Record<string, readonly string[]>>((groups, [key, needs]) => {
    const group = awaitedKey(needs, levelOne);
    return { ...groups, [group]: [...(groups[group] ?? []), key] };
  }, {});
}

/**
 * The runners one group of late jobs adds over the jobs it waits for.
 *
 * <p>The group starts only once every job it waits for has ended, so the two
 * never hold more than the larger of their runner counts at once.
 *
 * @param group - The group key: the awaited level-1 jobs.
 * @param members - The late jobs in the group.
 * @returns How many runners the group adds; never negative.
 */
function groupExtra(group: string, members: readonly string[]): number {
  const jobs = prJobs();
  const runners = runnersByJob(jobs);
  const started = members.reduce((sum, key) => sum + runners[key], 0);
  const awaited = group.split('+').reduce((sum, key) => sum + (runners[key] ?? 0), 0);
  return Math.max(0, started - awaited);
}

/**
 * The runners each group of late jobs adds.
 *
 * @returns Added runners by group key.
 */
function lateExtras(): Readonly<Record<string, number>> {
  const table = lateGroups();
  const groups = Object.entries(table);
  const rows = groups.map(([group, members]) => [group, groupExtra(group, members)] as const);
  return Object.fromEntries(rows);
}

/**
 * The most runners `pr.yml` holds at once between `changes` and `Validate`.
 *
 * <p>Sound while the groups wait for disjoint jobs (PCB-2): no runner a
 * level-1 job frees is credited to two groups.
 *
 * @returns Level-1 runners plus what every group of late jobs adds.
 */
function prPeak(): number {
  const levelOne = levelOneJobs();
  const level1 = runnersByJob(levelOne);
  const extras = lateExtras();
  return total(level1) + total(extras);
}

/**
 * The siblings that fire on an open event but not on a push.
 *
 * @returns `[file, sibling]` rows.
 */
function openOnlySiblings(): readonly (readonly [string, ISibling])[] {
  const table = siblings();
  const all = Object.entries(table);
  return all.filter(
    ([, { types }]) => !types.includes(PUSH_TYPE) && types.some(type => OPEN_TYPES.includes(type)),
  );
}

/**
 * The `if:` of every job of the open-only siblings.
 *
 * @returns Conditions by job key.
 */
function openOnlyConditions(): Readonly<Record<string, unknown>> {
  const files = openOnlySiblings().map(([file]) => file);
  const jobs = files.flatMap(file => {
    const doc = load(file);
    return Object.entries(doc.jobs ?? {});
  });
  const rows = jobs.map(([key, job]) => [key, job.if] as const);
  return Object.fromEntries(rows);
}

/**
 * The `pr.yml` jobs that start only after `Validate`.
 *
 * @returns Their needs and runners by job key.
 */
function postValidateJobs(): PostValidateJobs {
  const jobs = prJobs();
  const keys = Object.keys(jobs);
  const after = keys.filter(key => key !== VALIDATE_JOB_KEY && reachesValidate(key, jobs));
  const rows = after.map(key => {
    const job = jobs[key] ?? {};
    return [key, { needs: needsOf(job), runners: runnersOf(key, job) }] as const;
  });
  return Object.fromEntries(rows);
}

/**
 * The most runners one approval group holds at once: its gate's or its legs'.
 *
 * @param gate - The gate's job key.
 * @param gateRunners - The gate's runners.
 * @param after - The post-`Validate` jobs.
 * @returns The larger of the two.
 */
function groupPeak(gate: string, gateRunners: number, after: PostValidateJobs): number {
  const rows = Object.values(after);
  const legs = rows.filter(({ needs }) => needs.includes(gate));
  const legRunners = legs.reduce((sum, { runners }) => sum + runners, 0);
  return Math.max(gateRunners, legRunners);
}

/**
 * Whether a post-`Validate` job is the preflight, a gate or awaits a gate.
 *
 * @param key - The job key.
 * @param needs - The job's needs.
 * @param gates - The gates' job keys.
 * @returns True when the group peak already counts it.
 */
function isGrouped(key: string, needs: readonly string[], gates: readonly string[]): boolean {
  if (key === PREFLIGHT_JOB_KEY || gates.includes(key)) return true;
  return needs.some(need => gates.includes(need));
}

/**
 * The runners of the post-`Validate` jobs outside the preflight and groups.
 *
 * @param after - The post-`Validate` jobs.
 * @param gates - The gates' job keys.
 * @returns Their total, as if they all ran at once beside everything else.
 */
function otherRunners(after: PostValidateJobs, gates: readonly string[]): number {
  const rows = Object.entries(after);
  const others = rows.filter(([key, { needs }]) => !isGrouped(key, needs, gates));
  return others.reduce((sum, [, { runners }]) => sum + runners, 0);
}

/**
 * The most runners the post-`Validate` jobs hold at once. The preflight ends
 * before any gate starts, and a group holds its gate's runner or its legs',
 * never both. Any other post-`Validate` job is added in full.
 *
 * @param after - The post-`Validate` jobs.
 * @returns The peak.
 */
function postValidatePeak(after: PostValidateJobs): number {
  const rows = Object.entries(after);
  const gates = rows.filter(([, { needs }]) => needs.includes(PREFLIGHT_JOB_KEY));
  const groups = gates.map(([gate, { runners }]) => groupPeak(gate, runners, after));
  const peak = groups.reduce((sum, count) => sum + count, 0);
  const preflight = PREFLIGHT_JOB_KEY in after ? after[PREFLIGHT_JOB_KEY].runners : 0;
  const gateKeys = gates.map(([gate]) => gate);
  const others = otherRunners(after, gateKeys);
  return Math.max(preflight, peak) + others;
}

/**
 * The `pr.yml` jobs that neither feed nor follow `Validate`, as `file#job`
 * runs: they may still be running when the E2E-real legs start.
 *
 * @returns `[run, runners]` rows.
 */
function prRunsOutsideValidate(): readonly (readonly [string, number])[] {
  const jobs = prJobs();
  const feeding = upstreamOf(VALIDATE_JOB_KEY, jobs);
  const keys = Object.keys(jobs).filter(key => !feeding.has(key) && !reachesValidate(key, jobs));
  return keys.map(key => [`${PR_YAML}#${key}`, runnersOf(key, jobs[key] ?? {})] as const);
}

/**
 * Every job one job waits for, directly or through another job.
 *
 * @param key - The job key.
 * @param jobs - All jobs.
 * @returns Their keys.
 */
function upstreamOf(key: string, jobs: Jobs): ReadonlySet<string> {
  const needs = needsOf(jobs[key] ?? {});
  const deeper = needs.flatMap(need => [...upstreamOf(need, jobs)]);
  return new Set([...needs, ...deeper]);
}

/**
 * Every job of a sibling that fires on a push, as a `file#job` run.
 *
 * @returns `[run, runners]` rows.
 */
function pushSiblingRuns(): readonly (readonly [string, number])[] {
  const table = siblings();
  const all = Object.entries(table);
  const onPush = all.filter(([, { types }]) => types.includes(PUSH_TYPE));
  return onPush.flatMap(([file, { runners }]) => {
    const jobs = Object.entries(runners);
    return jobs.map(([job, count]) => [`${file}#${job}`, count] as const);
  });
}

/**
 * The push runs that may still hold a runner when the E2E-real legs start.
 *
 * @returns Runners by `file#job`.
 */
function runsBesideLegs(): Readonly<Record<string, number>> {
  const own = prRunsOutsideValidate();
  const sibling = pushSiblingRuns();
  const rows = [...own, ...sibling].filter(([run]) => !ENDS_BEFORE_VALIDATE.includes(run));
  return Object.fromEntries(rows);
}

describe('PushConcurrencyBound', () => {
  it('[PCB-1] starts exactly the modelled level-1 jobs, at most 12 runners before Validate', () => {
    const level1 = levelOneJobs();
    const runners = runnersByJob(level1);
    const peak = prPeak();
    expect(runners).toStrictEqual(LEVEL_1_RUNNERS);
    expect(peak).toBeLessThanOrEqual(LEVEL_1_CAP);
  });

  it('[PCB-2] starts only the modelled late jobs, each group after its own level-1 jobs', () => {
    const late = lateJobs();
    const groups = lateGroups();
    const awaited = Object.keys(groups).flatMap(group => group.split('+'));
    const extras = lateExtras();
    expect(late).toStrictEqual(LATE_JOBS);
    expect(new Set(awaited).size).toBe(awaited.length);
    expect(extras).toStrictEqual(LATE_EXTRA);
  });

  it('[PCB-3] is started beside exactly the modelled sibling workflows', () => {
    const found = siblings();
    expect(found).toStrictEqual(SIBLINGS);
  });

  it('[PCB-4] needs at most 18 runners on a push and 19 on an open event', () => {
    const level1 = prPeak();
    const table = siblings();
    const all = Object.values(table);
    const onPush = all.filter(({ types }) => types.includes(PUSH_TYPE));
    const siblingTotal = onPush.reduce((sum, { runners }) => sum + total(runners), 0);
    const pushPeak = level1 + siblingTotal + DYNAMIC_RUNS;
    const openTotals = openOnlySiblings().map(([, { runners }]) => total(runners));
    const openExtra = Math.max(0, ...openTotals);
    const stages = stageRunners();
    expect(stages).toStrictEqual(STAGE_RUNNERS);
    expect(pushPeak).toBeLessThanOrEqual(PUSH_BOUND);
    expect(pushPeak + openExtra).toBeLessThanOrEqual(PUSH_BOUND + 1);
  });

  it('[PCB-5] never runs both open-event jobs on one PR', () => {
    const conditions = openOnlyConditions();
    expect(conditions).toStrictEqual(OPEN_EVENT_IFS);
  });

  it('[PCB-6] cancels the superseded run of every workflow a push or edit starts', () => {
    const rows = workflowFiles().map(file => [file, load(file)] as const);
    const restarting = rows.filter(([, doc]) => {
      const types = prTypesOf(doc);
      return types.includes(PUSH_TYPE) || types.includes(EDIT_TYPE);
    });
    const uncancelled = restarting.filter(
      ([, doc]) => doc.concurrency?.['cancel-in-progress'] !== true,
    );
    const exempt = uncancelled.map(([file]) => file);
    expect(restarting.length).toBeGreaterThan(CANCEL_EXEMPT.length);
    expect(exempt).toStrictEqual(CANCEL_EXEMPT);
  });

  it('[PCB-7] needs at most 18 runners once the E2E-real legs start', () => {
    const after = postValidateJobs();
    const legsPeak = postValidatePeak(after);
    const beside = runsBesideLegs();
    const besideTotal = total(beside);
    expect(after).toStrictEqual(POST_VALIDATE_JOBS);
    expect(beside).toStrictEqual(RUNS_BESIDE_LEGS);
    expect(legsPeak + besideTotal + DYNAMIC_RUNS).toBeLessThanOrEqual(PUSH_BOUND);
  });
});
