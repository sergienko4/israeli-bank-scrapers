/**
 * Cache cleanup contract for `.github/workflows/cache-cleanup.yml`.
 *
 * <p>The step deletes caches, so a wrong turn costs every open PR and `main`
 * their cache hits. The rows below run the committed `run:` script under the
 * workflow's own shell, against a `gh` stub that keeps a fake cache list, and
 * compare the caches left behind.
 *
 * Rules:
 *   CCG-1  only a closed PR's own `refs/pull/<N>/merge` caches are deleted;
 *          open PRs, `main` and look-alike branch refs keep theirs; the sweep
 *          reads every page of the cache list
 *   CCG-2  an API failure, a non-numeric PR number, or caches left after a
 *          failed delete fail the job; a delete another run won does not
 *   CCG-3  least privilege (a fork PR's close, whose token is read-only, is
 *          left to the sweep), per-PR uncancelled groups, and no expression
 *          inside the script
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { canRunPosixBash } from '../../../Helpers/HostCapabilities.js';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/cache-cleanup.yml');

const MAIN = 'refs/heads/main';
const LOOK_ALIKE = 'refs/heads/pull/9/merge';
/** The job runs on the sweep, a dispatch, and a same-repo PR's close. */
const SKIP_FORK_CLOSE =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";

/**
 * A PR's cache ref.
 * @param n - PR number.
 * @returns `refs/pull/<n>/merge`.
 */
function prRef(n: number): string {
  return `refs/pull/${String(n)}/merge`;
}

/**
 * `gh` stub. Models only the calls the script makes, as the real CLI does
 * (`--jq` on `pr view` and `cache list` needs a `--json` field list;
 * `cache delete --all` with no `--ref` deletes every cache; `cache list`
 * returns at most 30 unless `--limit` says otherwise; `api` without
 * `--paginate` returns the first page only); anything else exits 99 so a
 * changed command fails the suite instead of passing against a guess.
 * `caches` is least recently used first.
 */
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.GH_STUB_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = text => process.stdout.write(text === '' ? '' : text + '\\n');
const cmd = args.slice(0, 2).join(' ');
const jq = flag('--jq');
const fields = flag('--json');
if (cmd === 'pr view' && fields === 'state' && jq === '.state') {
  const prState = state.prs[args[2]];
  if (prState === undefined) process.exit(1);
  out(prState);
  process.exit(0);
}
if (args[0] === 'api') {
  if (state.failList) process.exit(1);
  const endpoint = 'repos/' + process.env.GH_REPO + '/actions/caches';
  const path = args.find(arg => arg.startsWith('repos/')) ?? '';
  const [base, query = ''] = path.split('?');
  if (base !== endpoint || jq !== '.actions_caches[].ref') process.exit(99);
  const perPage = Number(new URLSearchParams(query).get('per_page') ?? 30);
  const newestFirst = [...state.caches].reverse();
  out((args.includes('--paginate') ? newestFirst : newestFirst.slice(0, perPage)).join('\\n'));
  process.exit(0);
}
if (cmd === 'cache list' && fields === 'id' && jq === 'length') {
  if (state.failList) process.exit(1);
  const ref = flag('--ref');
  const matched = state.caches.filter(row => ref === undefined || row === ref);
  out(String(Math.min(matched.length, Number(flag('--limit') ?? 30))));
  process.exit(0);
}
if (cmd === 'cache delete' && args.includes('--all')) {
  if (state.deleteMode === 'broken') process.exit(1);
  const ref = flag('--ref');
  const kept = state.caches.filter(row => ref !== undefined && row !== ref);
  const deleted = state.caches.length - kept.length;
  state.caches = kept;
  fs.writeFileSync(file, JSON.stringify(state));
  if (state.deleteMode === 'raced') process.exit(1);
  process.exit(deleted > 0 || args.includes('--succeed-on-no-caches') ? 0 : 1);
}
process.exit(99);
`;

/** How the stub's `gh cache delete` behaves. */
type DeleteMode = 'ok' | 'raced' | 'broken';

/** The fake repository the stub serves. */
interface IStubState {
  readonly prs: Readonly<Record<string, string>>;
  readonly caches: readonly string[];
  readonly failList: boolean;
  readonly deleteMode: DeleteMode;
}

/** One scenario: the event, the repository, and the expected outcome. */
interface IScenario {
  readonly label: string;
  readonly prNumber: string;
  readonly state: IStubState;
  readonly shouldPass: boolean;
  readonly cachesLeft: readonly string[];
}

/** What a run left behind. */
interface IOutcome {
  readonly isPassed: boolean;
  readonly cachesLeft: readonly string[];
}

/**
 * Build a stub state with the common defaults.
 * @param prs - PR number → `gh pr view` state.
 * @param caches - One ref per cache entry.
 * @param overrides - Failure switches.
 * @returns The state.
 */
function stateOf(
  prs: Readonly<Record<string, string>>,
  caches: readonly string[],
  overrides: Partial<Pick<IStubState, 'failList' | 'deleteMode'>> = {},
): IStubState {
  return { prs, caches, failList: false, deleteMode: 'ok', ...overrides };
}

const ALL_KINDS = [prRef(7), prRef(7), prRef(8), prRef(9), MAIN, LOOK_ALIKE];
const MIXED_PRS = { '7': 'MERGED', '8': 'OPEN', '9': 'CLOSED' };

/** Open-PR caches: more than any one page or capped list would reach past. */
const OPEN_CACHES = Array.from({ length: 1000 }, (): string => prRef(8));

const CCG1_ROWS: readonly IScenario[] = [
  {
    label: 'closing a merged PR deletes its caches only',
    prNumber: '7',
    state: stateOf(MIXED_PRS, ALL_KINDS),
    shouldPass: true,
    cachesLeft: [prRef(8), prRef(9), MAIN, LOOK_ALIKE],
  },
  {
    label: 'a PR reopened before the run keeps its caches',
    prNumber: '8',
    state: stateOf(MIXED_PRS, ALL_KINDS),
    shouldPass: true,
    cachesLeft: ALL_KINDS,
  },
  {
    label: 'closing a PR with no caches succeeds',
    prNumber: '9',
    state: stateOf(MIXED_PRS, [MAIN]),
    shouldPass: true,
    cachesLeft: [MAIN],
  },
  {
    label: 'the sweep deletes every closed PR and nothing else',
    prNumber: '',
    state: stateOf(MIXED_PRS, ALL_KINDS),
    shouldPass: true,
    cachesLeft: [prRef(8), MAIN, LOOK_ALIKE],
  },
  {
    label: 'the sweep with no PR caches succeeds',
    prNumber: '',
    state: stateOf(MIXED_PRS, [MAIN]),
    shouldPass: true,
    cachesLeft: [MAIN],
  },
  {
    label: 'the sweep reads every page, so no cap hides a closed PR',
    prNumber: '',
    state: stateOf(MIXED_PRS, [...OPEN_CACHES, prRef(9), ...OPEN_CACHES]),
    shouldPass: true,
    cachesLeft: [...OPEN_CACHES, ...OPEN_CACHES],
  },
];

const CCG2_ROWS: readonly IScenario[] = [
  {
    label: 'a failed cache listing fails the sweep',
    prNumber: '',
    state: stateOf(MIXED_PRS, ALL_KINDS, { failList: true }),
    shouldPass: false,
    cachesLeft: ALL_KINDS,
  },
  {
    label: 'a non-numeric PR number fails before any delete',
    prNumber: '../7',
    state: stateOf({ '../7': 'CLOSED' }, ALL_KINDS),
    shouldPass: false,
    cachesLeft: ALL_KINDS,
  },
  {
    label: 'a delete another run won still passes',
    prNumber: '7',
    state: stateOf(MIXED_PRS, ALL_KINDS, { deleteMode: 'raced' }),
    shouldPass: true,
    cachesLeft: [prRef(8), prRef(9), MAIN, LOOK_ALIKE],
  },
  {
    label: 'a failed delete with caches left fails',
    prNumber: '7',
    state: stateOf(MIXED_PRS, ALL_KINDS, { deleteMode: 'broken' }),
    shouldPass: false,
    cachesLeft: ALL_KINDS,
  },
];

/** Workflow fields this suite reads. */
interface IWorkflowDoc {
  readonly on: Readonly<Record<string, { readonly types?: readonly string[] } | null>>;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly concurrency?: { readonly group?: string; readonly 'cancel-in-progress'?: boolean };
  readonly defaults?: { readonly run?: { readonly shell?: string } };
  readonly jobs: Readonly<Record<string, IJobDoc>>;
}

/** Job fields this suite reads. */
interface IJobDoc {
  readonly if?: string;
  readonly 'timeout-minutes'?: number;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly steps: readonly IStepDoc[];
}

/** Step fields this suite reads. */
interface IStepDoc {
  readonly env?: Readonly<Record<string, string>>;
  readonly run?: string;
}

/**
 * Parse the workflow.
 * @returns The parsed document.
 */
function loadWorkflow(): IWorkflowDoc {
  const text = readFileSync(WORKFLOW, 'utf8');
  return parse(text) as IWorkflowDoc;
}

/**
 * The workflow's only job.
 * @param doc - Parsed workflow.
 * @returns The job; throws unless there is exactly one.
 */
function onlyJob(doc: IWorkflowDoc): IJobDoc {
  const jobs = Object.values(doc.jobs);
  if (jobs.length !== 1) throw new RangeError(`expected one job, found ${String(jobs.length)}`);
  return jobs[0];
}

/**
 * The cleanup step.
 * @param doc - Parsed workflow.
 * @returns The job's only step that has a `run:` body.
 */
function cleanupStep(doc: IWorkflowDoc): IStepDoc {
  const steps = onlyJob(doc).steps.filter((step): boolean => step.run !== undefined);
  if (steps.length !== 1)
    throw new RangeError(`expected one run step, found ${String(steps.length)}`);
  return steps[0];
}

/**
 * The cleanup script.
 * @param doc - Parsed workflow.
 * @returns The cleanup step's `run:` body.
 */
function cleanupScript(doc: IWorkflowDoc): string {
  return cleanupStep(doc).run ?? '';
}

/**
 * Run a callback inside a throwaway directory, removing it afterwards.
 * @param body - Receives the directory path.
 * @returns What the callback returned.
 */
function inTempDir<T>(body: (dir: string) => T): T {
  const temp = tmpdir();
  const prefix = join(temp, 'ccg-');
  const dir = mkdtempSync(prefix);
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write the `gh` stub and its state into a directory.
 * @param dir - Target directory.
 * @param state - The fake repository.
 * @returns The state file path.
 */
function installStub(dir: string, state: IStubState): string {
  const stub = join(dir, 'gh');
  writeFileSync(stub, GH_STUB);
  chmodSync(stub, 0o755);
  const stateFile = join(dir, 'state.json');
  const json = JSON.stringify(state);
  writeFileSync(stateFile, json);
  return stateFile;
}

/**
 * The environment a run sees: the stub first on `PATH`, plus the step's input.
 * `GITHUB_REF` is `main`, as on a merged PR's `closed` run and on the sweep.
 * @param dir - Directory holding the stub and its state.
 * @param prNumber - The step's `PR_NUMBER`.
 * @returns The environment.
 */
function stubEnv(dir: string, prNumber: string): NodeJS.ProcessEnv {
  const path = `${dir}${delimiter}${process.env.PATH ?? ''}`;
  const stateFile = join(dir, 'state.json');
  const step = { PR_NUMBER: prNumber, GITHUB_REF: MAIN, GH_REPO: 'owner/repo' };
  return { ...process.env, PATH: path, ...step, GH_STUB_STATE: stateFile };
}

/**
 * Run the committed script the way Actions does: from a file, under `defaults.run.shell`.
 * @param doc - Parsed workflow.
 * @param dir - Working directory holding the stub.
 * @param prNumber - The step's `PR_NUMBER`.
 * @returns The exit status.
 */
function runScript(doc: IWorkflowDoc, dir: string, prNumber: string): number {
  const file = join(dir, 'step.sh');
  const script = cleanupScript(doc);
  writeFileSync(file, script);
  const argv = (doc.defaults?.run?.shell ?? '').split(' ').filter((token): boolean => token !== '');
  const [command, ...rest] = argv.map((token): string => (token === '{0}' ? file : token));
  const env = stubEnv(dir, prNumber);
  return spawnSync(command, rest, { cwd: dir, encoding: 'utf8', env }).status ?? -1;
}

/**
 * Play one scenario.
 * @param scenario - The row.
 * @returns Whether the job passed and which caches it left.
 */
function play(scenario: IScenario): IOutcome {
  const doc = loadWorkflow();
  return inTempDir((dir): IOutcome => {
    const stateFile = installStub(dir, scenario.state);
    const status = runScript(doc, dir, scenario.prNumber);
    const text = readFileSync(stateFile, 'utf8');
    const after = JSON.parse(text) as IStubState;
    return { isPassed: status === 0, cachesLeft: after.caches };
  });
}

/**
 * The outcome a row expects.
 * @param scenario - The row.
 * @returns Its expected outcome.
 */
function expectedOf(scenario: IScenario): IOutcome {
  return { isPassed: scenario.shouldPass, cachesLeft: scenario.cachesLeft };
}

/** `[what, how to read it from the workflow, expected]` for one CCG-3 pin. */
type WorkflowPin = readonly [string, (doc: IWorkflowDoc) => unknown, unknown];

// CCG-3: triggers, least privilege, the fork-close skip and per-PR groups.
const WORKFLOW_PINS: readonly WorkflowPin[] = [
  [
    'Triggers',
    (doc): unknown => Object.keys(doc.on).sort(),
    ['pull_request', 'schedule', 'workflow_dispatch'],
  ],
  ['PrTypes', (doc): unknown => doc.on.pull_request?.types, ['closed']],
  ['WorkflowPermissions', (doc): unknown => doc.permissions, {}],
  [
    'JobPermissions',
    (doc): unknown => onlyJob(doc).permissions,
    { actions: 'write', 'pull-requests': 'read' },
  ],
  ['JobCondition', (doc): unknown => onlyJob(doc).if, SKIP_FORK_CLOSE],
  ['Timeout', (doc): unknown => onlyJob(doc)['timeout-minutes'], 5],
  [
    'Concurrency',
    (doc): unknown => doc.concurrency,
    {
      group: "cache-cleanup-${{ github.event.pull_request.number || 'sweep' }}",
      'cancel-in-progress': false,
    },
  ],
  ['ScriptExpressions', (doc): unknown => cleanupScript(doc).includes('${{'), false],
];

describe('CacheCleanupGate', () => {
  it.each(CCG1_ROWS)('[CCG-1] $label', scenario => {
    if (canRunPosixBash(process.platform)) {
      const outcome = play(scenario);
      const expected = expectedOf(scenario);
      expect(outcome).toEqual(expected);
    }
  });

  it.each(CCG2_ROWS)('[CCG-2] $label', scenario => {
    if (canRunPosixBash(process.platform)) {
      const outcome = play(scenario);
      const expected = expectedOf(scenario);
      expect(outcome).toEqual(expected);
    }
  });

  it.each(WORKFLOW_PINS)('[CCG-3] Workflow_%s_ShouldBePinned', (_label, read, expected) => {
    const doc = loadWorkflow();
    const actual = read(doc);
    expect(actual).toEqual(expected);
  });

  it('[CCG-3] Step_ShouldTakeEveryInputThroughEnv', () => {
    const doc = loadWorkflow();
    const step = cleanupStep(doc);
    expect(step.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
    });
  });
});
