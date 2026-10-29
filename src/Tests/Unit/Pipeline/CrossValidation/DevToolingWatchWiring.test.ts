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
 */

import { parse } from 'yaml';

import { PROBE_BUDGET_MS } from '../../../../../scripts/dev-tooling/watch.mjs';
import { readRepoFile, trackedFiles } from '../../../Helpers/RepoFiles.js';

const WORKFLOW_FILE = '.github/workflows/dev-tooling-watch.yml';
const ENTRY = 'scripts/dev-tooling-watch.mjs';
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
});
