/**
 * Daily dev-tooling watch wiring (`dev-tooling-watch.yml`).
 *
 * <p>The probe runs lint-tooling releases no one here has reviewed, so it
 * holds `contents: read` only, keeps no credential and gets no token. The
 * job that holds `issues: write` runs nothing it downloads: no checkout, no
 * npm. It reads only the verdict, checks it, and writes the issue body itself
 * from it and the run's URL. It touches one issue: open, titled
 * `Dev-tooling watch`, labelled `dev-tooling-watch`, and opened by the
 * workflow itself. It opens or edits it on `fail` or `error` and closes it on
 * `pass` or `no-candidate`. A manual run is a dry run unless `dry_run` is
 * cleared. What the probe installs, which gates it runs and the time each
 * gets is pinned by the watch's unit test (`DevToolingWatch.test.ts`).
 *
 * Rules:
 *   DWW-1  the triggers are exactly a daily 03:17 UTC schedule and a dispatch
 *   DWW-2  a dispatch takes a boolean `dry_run`, true by default
 *   DWW-3  the root grants nothing; the probe reads contents, the report job
 *          writes issues, and nothing else
 *   DWW-4  one concurrency group, never cancelled
 *   DWW-5  the probe checks out without credentials, keeps no npm cache,
 *          installs without lifecycle scripts, runs an entry that exists, and
 *          uploads the files it writes
 *   DWW-6  no probe step gets a token or a secret
 *   DWW-7  the report job needs the probe, skips a dry run, runs nothing it
 *          downloads, reads only the verdict, and writes every body itself
 *   DWW-8  the issue step checks the verdict, picks only the issue the
 *          workflow opened under the watch's title, opens or edits it on fail
 *          or error, and closes it on pass or no-candidate
 *   DWW-9  Dependabot's npm run is Monday 07:00 UTC, after that day's watch
 *          has had its whole job time
 *   DWW-10 the probe job outlasts the probe's time budget plus setup, so the
 *          probe writes its verdict before the job is killed
 *   DWW-11 run for real under bash with real jq, a recording `gh` and an
 *          artifact that carries hostile text, the issue step writes only
 *          the body it builds, to the issue the workflow opened, and calls no
 *          `gh` at all on an unknown verdict
 *   DWW-12 a change to the watch's files alone sets `ci_scripts`, which runs
 *          the unit tests that pin the watch
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { PROBE_BUDGET_MS } from '../../../../../scripts/dev-tooling/watch.mjs';
import { canRunPosixBash } from '../../../Helpers/HostCapabilities.js';
import { readRepoFile, trackedFiles } from '../../../Helpers/RepoFiles.js';
import { createTempRepo, writeTempFile } from '../../../Helpers/TempRepoTree.js';

const WORKFLOW_FILE = '.github/workflows/dev-tooling-watch.yml';
const ENTRY = 'scripts/dev-tooling-watch.mjs';
const WATCH_DIR = 'scripts/dev-tooling/';
const DETECTOR_FILE = '.github/scripts/ci/detect-changes.sh';
const PR_WORKFLOW_FILE = '.github/workflows/pr.yml';
const RUNS_ON_CI_SCRIPTS = "needs.changes.outputs.ci_scripts == 'true'";
/** The detector's `ci_scripts` test, kept on one line so its alternation can be read back. */
const CI_SCRIPTS_LINE = /^if has '([^']+)'; then ci_scripts=true; fi\r?$/mu;
const LABEL = 'dev-tooling-watch';
const ARTIFACT = 'dev-tooling-watch';
const OUT_DIR = '"$RUNNER_TEMP/dev-tooling-watch';
const PROBE_STEP = 'Probe the newest lint tooling';
const ISSUE_STEP = 'Update the watch issue';
const EXPRESSION_OPEN = '$' + '{{';
const NOT_DRY_RUN = `${EXPRESSION_OPEN} !inputs.dry_run }}`;
const WATCH_HOUR = 3;
/** Off the hour: GitHub delays or drops top-of-the-hour scheduled runs most. */
const WATCH_MINUTE = 17;
const MINUTE_MS = 60_000;
/** Checkout, setup-node, `npm ci` and the upload, around the probe's budget. */
const SETUP_MINUTES = 10;

/** The probe's steps, by the action each uses or else by name. */
const PROBE_STEPS = [
  'actions/checkout',
  'actions/setup-node',
  'Install without lifecycle scripts',
  PROBE_STEP,
  'actions/upload-artifact',
];

/** The report job's steps. */
const REPORT_STEPS = ['actions/download-artifact', ISSUE_STEP];

/** The issue step's commands, line continuations joined. */
const ISSUE_COMMANDS = [
  '.verdict | select(IN("pass", "fail", "error", "no-candidate"))',
  'run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"',
  `gh label create ${LABEL} --force`,
  `gh issue list --label ${LABEL} --state open --limit 100 --json number,author,title`,
  '[.[] | select(.author.login == "app/github-actions" and .title == "Dev-tooling watch")]' +
    '[0].number // empty',
  'fail | error)',
  'gh issue edit "$number" --body "$body"',
  `gh issue create --title 'Dev-tooling watch' --label ${LABEL} --body "$body"`,
  'pass | no-candidate)',
  'gh issue close "$number" --comment',
];

/** A token or a secret, by expression. */
const CREDENTIAL = /github\.token|secrets\./u;

/** Text a hostile artifact carries where the issue step must not read it. */
const HOSTILE = 'HOSTILE-ARTIFACT-TEXT';

/** The run the issue step links to, as the runner names it. */
const RUN_ENV = {
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'o/r',
  GITHUB_RUN_ID: '42',
};
const RUN_URL = 'https://github.com/o/r/actions/runs/42';

/** Ends each argument, then each call, in the stub `gh`'s log. */
const ARG_END = '\u001f';
const CALL_END = '\u001e';

/**
 * A `gh` that logs each call's arguments to `$GH_LOG`, and answers
 * `issue list` by applying the step's own `--jq` to `$STUB_ISSUES`.
 */
const GH_STUB = [
  '#!/bin/sh',
  'set -e',
  'printf \'%s\\037\' "$@" >> "$GH_LOG"',
  'printf \'\\036\' >> "$GH_LOG"',
  'if [ "$1 $2" != "issue list" ]; then exit 0; fi',
  'while [ "$#" -gt 1 ] && [ "$1" != --jq ]; do shift; done',
  'exec jq -r "$2" "$STUB_ISSUES"',
].join('\n');

/** An open issue as `gh issue list --json number,author,title` lists it. */
interface IOpenIssue {
  readonly number: number;
  readonly author: { readonly login: string };
  readonly title: string;
}

/** Open issues the watch must not touch: another author's, and another title. */
const DECOYS: readonly IOpenIssue[] = [
  { number: 3, author: { login: 'someone' }, title: 'Dev-tooling watch' },
  { number: 5, author: { login: 'app/github-actions' }, title: 'Something else' },
];

/** The issue the watch opened, with the decoys. */
const WITH_WATCH_ISSUE: readonly IOpenIssue[] = [
  ...DECOYS,
  { number: 7, author: { login: 'app/github-actions' }, title: 'Dev-tooling watch' },
];

/** One `gh` call's arguments. */
type GhCall = readonly string[];

/** What one run of the issue step did. */
interface IIssueRun {
  readonly status: number;
  readonly log: string;
  readonly calls: readonly GhCall[];
}

/** Fixture roots to remove after each case. */
const TREES: string[] = [];

interface IStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
}

interface IJob {
  readonly needs?: unknown;
  readonly if?: string;
  readonly 'timeout-minutes'?: number;
  readonly permissions?: unknown;
  readonly steps: readonly IStep[];
}

interface IWorkflow {
  readonly on: {
    readonly schedule?: readonly { readonly cron: string }[];
    readonly workflow_dispatch?: {
      readonly inputs?: Readonly<Record<string, { type?: string; default?: unknown }>>;
    };
  };
  readonly permissions?: unknown;
  readonly concurrency?: unknown;
  readonly jobs: Readonly<Record<string, IJob>>;
}

/** pr.yml, read only for its jobs. */
interface IPrWorkflow {
  readonly jobs: Readonly<Record<string, IJob>>;
}

interface IDependabotSchedule {
  readonly interval?: string;
  readonly day?: string;
  readonly time?: string;
  readonly timezone?: string;
}

interface IDependabot {
  readonly updates: readonly {
    readonly 'package-ecosystem': string;
    readonly directory?: string;
    readonly schedule: IDependabotSchedule;
  }[];
}

const WORKFLOW_TEXT = readRepoFile(WORKFLOW_FILE);
const WORKFLOW = parse(WORKFLOW_TEXT) as IWorkflow;
const { probe: PROBE, report: REPORT } = WORKFLOW.jobs;

/**
 * How the step lists name a step.
 *
 * @param step - Workflow step.
 * @returns The action it uses without its ref, or else its name.
 */
function stepId(step: IStep): string {
  const action = step.uses?.split('@')[0];
  return action ?? step.name ?? '';
}

/**
 * One step of a job by name.
 *
 * @param job - The job.
 * @param name - Step name.
 * @returns The step; an empty one when no step has that name.
 */
function stepNamed(job: IJob, name: string): IStep {
  return job.steps.find((step): boolean => step.name === name) ?? {};
}

/**
 * A step's script with its line continuations joined.
 *
 * @param step - Workflow step.
 * @returns One line per command.
 */
function scriptOf(step: IStep): string {
  const script = step.run ?? '';
  return script.replace(/\\\n\s*/gu, '');
}

/**
 * The issue step's script, line continuations joined.
 *
 * @returns One line per command.
 */
function issueScript(): string {
  const step = stepNamed(REPORT, ISSUE_STEP);
  return scriptOf(step);
}

/**
 * The root npm entry's schedule in `.github/dependabot.yml`.
 *
 * @returns Its schedule.
 */
function npmSchedule(): IDependabotSchedule {
  const text = readRepoFile('.github/dependabot.yml');
  const config = parse(text) as IDependabot;
  const npm = config.updates.find(u => u['package-ecosystem'] === 'npm' && u.directory === '/');
  return npm?.schedule ?? {};
}

/**
 * Minutes since midnight.
 *
 * @param time - `HH:MM`.
 * @returns Its minutes.
 */
function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * The issue body the step must write for a verdict.
 *
 * @param verdict - The verdict.
 * @returns The body, as `printf '%s\n\n%s\n'` builds it.
 */
function bodyFor(verdict: string): string {
  const summary = `The dev-tooling watch reports \`${verdict}\`.`;
  const link = `Each gate's result, with the output of a failing one, is on the run's summary: ${RUN_URL}`;
  return `${summary}\n\n${link}\n`;
}

/**
 * A downloaded artifact whose verdict file and report both carry `HOSTILE`.
 *
 * @param runnerTemp - The fake `$RUNNER_TEMP`.
 * @param verdict - The verdict to write.
 * @returns The verdict file's path.
 */
function writeArtifact(runnerTemp: string, verdict: string): string {
  const verdictText = JSON.stringify({ verdict, errors: [HOSTILE], gates: [] });
  writeTempFile(runnerTemp, `${ARTIFACT}/report.md`, `# ${HOSTILE}\n`);
  return writeTempFile(runnerTemp, `${ARTIFACT}/verdict.json`, verdictText);
}

/**
 * The stub `gh` and its fixtures.
 *
 * @param root - Fixture root.
 * @param open - The open issues `gh issue list` sees.
 * @returns The environment that puts the stub first on `PATH`.
 */
function ghEnv(root: string, open: readonly IOpenIssue[]): NodeJS.ProcessEnv {
  const gh = writeTempFile(root, 'bin/gh', GH_STUB);
  chmodSync(gh, 0o755);
  const openText = JSON.stringify(open);
  const issues = writeTempFile(root, 'issues.json', openText);
  const log = writeTempFile(root, 'gh.log', '');
  const path = `${join(root, 'bin')}:${process.env.PATH ?? ''}`;
  const stub = { PATH: path, RUNNER_TEMP: root, STUB_ISSUES: issues, GH_LOG: log };
  return { ...process.env, ...RUN_ENV, ...stub };
}

/**
 * `gh issue create` for the watch issue.
 *
 * @param verdict - The verdict.
 * @returns Its arguments.
 */
function createCall(verdict: string): GhCall {
  const body = bodyFor(verdict);
  return ['issue', 'create', '--title', 'Dev-tooling watch', '--label', LABEL, '--body', body];
}

/**
 * `gh issue edit` of the watch issue, #7.
 *
 * @param verdict - The verdict.
 * @returns Its arguments.
 */
function editCall(verdict: string): GhCall {
  const body = bodyFor(verdict);
  return ['issue', 'edit', '7', '--body', body];
}

/**
 * `gh issue close` of the watch issue, #7.
 *
 * @param verdict - The verdict.
 * @returns Its arguments.
 */
function closeCall(verdict: string): GhCall {
  return ['issue', 'close', '7', '--comment', `The dev-tooling watch now reports \`${verdict}\`.`];
}

/**
 * Run the issue step's real script as the workflow's default shell does.
 *
 * @param verdict - The verdict in the downloaded artifact.
 * @param open - The open issues `gh issue list` sees.
 * @returns Its exit status and the `gh` calls it made.
 */
function runIssueStep(verdict: string, open: readonly IOpenIssue[]): IIssueRun {
  const root = createTempRepo();
  TREES.push(root);
  writeArtifact(root, verdict);
  const env = ghEnv(root, open);
  const script = stepNamed(REPORT, ISSUE_STEP).run ?? '';
  const shell = ['--noprofile', '--norc', '-euo', 'pipefail', '-c', script];
  const result = spawnSync('bash', shell, { env, encoding: 'utf8', timeout: 30_000 });
  const log = readFileSync(env.GH_LOG ?? '', 'utf8');
  const calls = callsIn(log);
  return { status: result.status ?? -1, log, calls };
}

/**
 * The calls the stub `gh` logged.
 *
 * @param log - Its log.
 * @returns Each call's arguments, in order.
 */
function callsIn(log: string): readonly GhCall[] {
  const records = log.split(CALL_END).slice(0, -1);
  return records.map(record => record.split(ARG_END).slice(0, -1));
}

/**
 * The calls that write an issue: every `gh issue` call but the list.
 *
 * @param run - The step's run.
 * @returns Those calls, in order.
 */
function issueWrites(run: IIssueRun): readonly GhCall[] {
  return run.calls.filter(([group, verb]) => group === 'issue' && verb !== 'list');
}

/**
 * The detector's `ci_scripts` pattern, exactly as `has` passes it to `grep -E`.
 *
 * @returns The alternation; throws when the line is gone, since an empty
 *   pattern would match every path.
 */
function ciScriptsPattern(): string {
  const script = readRepoFile(DETECTOR_FILE);
  const line = CI_SCRIPTS_LINE.exec(script);
  if (line === null) throw new RangeError('detect-changes.sh: no one-line `ci_scripts=true` test');
  return line[1];
}

/**
 * The watch's tracked files: its entry and every module beside it.
 *
 * @returns Repo-relative paths.
 */
function watchFiles(): readonly string[] {
  return trackedFiles().filter(path => path === ENTRY || path.startsWith(WATCH_DIR));
}

/**
 * Whether the detector's `has` admits a path, through the same `grep -E`.
 *
 * @param pattern - The detector's alternation.
 * @param path - Repo-relative path.
 * @returns True when the path sets the flag.
 */
function detectorAdmits(pattern: string, path: string): boolean {
  const grep = spawnSync('grep', ['-qE', pattern], { input: `${path}\n` });
  return grep.status === 0;
}

/**
 * The condition pr.yml's unit-test job runs under.
 *
 * @returns Its `if`, or empty when it has none.
 */
function unitTestsCondition(): string {
  const text = readRepoFile(PR_WORKFLOW_FILE);
  const pr = parse(text) as IPrWorkflow;
  return pr.jobs['unit-tests'].if ?? '';
}

afterEach(() => {
  for (const root of TREES.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DevToolingWatchWiring', () => {
  it('[DWW-1] runs daily at 03:17 UTC and by hand, never on a PR or push', () => {
    const triggers = Object.keys(WORKFLOW.on).sort();
    expect(triggers).toEqual(['schedule', 'workflow_dispatch']);
    const cron = `${String(WATCH_MINUTE)} ${String(WATCH_HOUR)} * * *`;
    expect(WORKFLOW.on.schedule).toEqual([{ cron }]);
  });

  it('[DWW-2] a manual run is a dry run unless dry_run is cleared', () => {
    const inputs = WORKFLOW.on.workflow_dispatch?.inputs ?? {};
    const names = Object.keys(inputs);
    expect(names).toEqual(['dry_run']);
    expect(inputs.dry_run).toMatchObject({ type: 'boolean', default: true });
  });

  it('[DWW-3] grants the probe contents: read and the report job issues: write, nothing else', () => {
    expect(WORKFLOW.permissions).toEqual({});
    const jobs = Object.keys(WORKFLOW.jobs);
    expect(jobs).toEqual(['probe', 'report']);
    expect(PROBE.permissions).toEqual({ contents: 'read' });
    expect(REPORT.permissions).toEqual({ issues: 'write' });
  });

  it('[DWW-4] runs in one group and never cancels a run in progress', () => {
    const expected = { group: 'dev-tooling-watch', 'cancel-in-progress': false };
    expect(WORKFLOW.concurrency).toEqual(expected);
  });

  it('[DWW-5] probes from a clean install and uploads what the probe writes', () => {
    const steps = PROBE.steps.map(stepId);
    expect(steps).toEqual(PROBE_STEPS);
    const [checkout, setupNode, install, probe, upload] = PROBE.steps;
    expect(checkout.with).toEqual({ 'persist-credentials': false });
    expect(setupNode.with).toEqual({ 'node-version-file': '.nvmrc' });
    expect(install.run).toBe('npm ci --ignore-scripts --no-audit --no-fund');
    const script = scriptOf(probe);
    const command = `node ${ENTRY} --out ${OUT_DIR}/report.md" --verdict ${OUT_DIR}/verdict.json"`;
    expect(script).toContain(command);
    const tracked = trackedFiles();
    expect(tracked).toContain(ENTRY);
    expect(upload.with).toMatchObject({ name: ARTIFACT, 'if-no-files-found': 'error' });
    expect(upload.with?.path).toBe(`${EXPRESSION_OPEN} runner.temp }}/dev-tooling-watch/`);
  });

  it('[DWW-6] gives no probe step a token or a secret', () => {
    const probeText = JSON.stringify(PROBE);
    expect(probeText).not.toMatch(CREDENTIAL);
  });

  it('[DWW-7] the report job needs the probe, skips a dry run, and reads only the verdict', () => {
    expect(REPORT.needs).toBe('probe');
    expect(REPORT.if).toBe(NOT_DRY_RUN);
    const steps = REPORT.steps.map(stepId);
    expect(steps).toEqual(REPORT_STEPS);
    const [download] = REPORT.steps;
    expect(download.with).toMatchObject({ name: ARTIFACT });
    const script = issueScript();
    expect(script).not.toMatch(/\b(?:npm|npx|node)\b/u);
    const reads = script.match(/\$dir\/[\w.-]+/gu);
    expect(reads).toEqual(['$dir/verdict.json']);
    const bodies = script.match(/--body\S*\s+\S+/gu) ?? [];
    const kinds = new Set(bodies);
    expect([...kinds]).toEqual(['--body "$body"']);
  });

  it.each(ISSUE_COMMANDS)('[DWW-8] the issue step runs %s', command => {
    const script = issueScript();
    expect(script).toContain(command);
  });

  it("[DWW-9] Dependabot opens npm updates on Monday, after that day's watch has had its job time", () => {
    const schedule = npmSchedule();
    const expected = { interval: 'weekly', day: 'monday', time: '07:00', timezone: 'UTC' };
    expect(schedule).toEqual(expected);
    const dependabotAt = minutesOfDay(expected.time);
    const watchAt = WATCH_HOUR * 60 + WATCH_MINUTE;
    const probeMinutes = PROBE['timeout-minutes'] ?? Infinity;
    expect(dependabotAt).toBeGreaterThanOrEqual(watchAt + probeMinutes);
  });

  it('[DWW-10] the probe job outlasts the probe budget plus setup', () => {
    const budgetMinutes = PROBE_BUDGET_MS / MINUTE_MS;
    expect(PROBE['timeout-minutes']).toBeGreaterThanOrEqual(budgetMinutes + SETUP_MINUTES);
  });

  it.each<[string, readonly IOpenIssue[], readonly GhCall[]]>([
    ['fail', DECOYS, [createCall('fail')]],
    ['error', WITH_WATCH_ISSUE, [editCall('error')]],
    ['pass', WITH_WATCH_ISSUE, [editCall('pass'), closeCall('pass')]],
    ['no-candidate', DECOYS, []],
  ])('[DWW-11] on %s, run for real, writes only its own body', (verdict, open, writes) => {
    if (canRunPosixBash(process.platform)) {
      const run = runIssueStep(verdict, open);
      expect(run.status).toBe(0);
      const first = run.calls.slice(0, 2).map(call => call.slice(0, 2));
      expect(first).toEqual([
        ['label', 'create'],
        ['issue', 'list'],
      ]);
      const written = issueWrites(run);
      expect(written).toEqual(writes);
      expect(run.log).not.toContain(HOSTILE);
    }
  });

  it('[DWW-11] fails on an unknown verdict before it calls gh', () => {
    if (canRunPosixBash(process.platform)) {
      const run = runIssueStep(`fail; ${HOSTILE}`, WITH_WATCH_ISSUE);
      expect(run.status).not.toBe(0);
      expect(run.calls).toEqual([]);
    }
  });

  it('[DWW-12] a change to the watch alone runs the unit tests that pin it', () => {
    const files = watchFiles();
    expect(files).toContain(ENTRY);
    expect(files).toContain(`${WATCH_DIR}watch.mjs`);
    const condition = unitTestsCondition();
    expect(condition).toContain(RUNS_ON_CI_SCRIPTS);
    const pattern = ciScriptsPattern();
    // `has` pipes into POSIX grep, which native Windows lacks.
    if (canRunPosixBash(process.platform)) {
      const missed = files.filter(path => !detectorAdmits(pattern, path));
      expect(missed).toEqual([]);
    }
  });
});
