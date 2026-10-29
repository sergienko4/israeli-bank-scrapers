/**
 * Daily dev-tooling watch wiring (`dev-tooling-watch.yml`).
 *
 * <p>The probe runs lint-tooling releases no one here has reviewed, so it
 * holds `contents: read` only, keeps no credential and gets no token. The
 * job that holds `issues: write` runs nothing it downloads: no checkout, no
 * npm. It touches one issue: open, labelled `dev-tooling-watch`, and opened
 * by the workflow itself. It opens or edits it on `fail` or `error` and
 * closes it on `pass` or `no-candidate`. A manual run is a dry run unless
 * `dry_run` is cleared. What the probe installs and which gates it runs is
 * pinned by the watch's unit test (`DevToolingWatch.test.ts`).
 *
 * Rules:
 *   DWW-1  the triggers are exactly a daily 03:00 UTC schedule and a dispatch
 *   DWW-2  a dispatch takes a boolean `dry_run`, true by default
 *   DWW-3  the root grants nothing; the probe reads contents, the report job
 *          writes issues, and nothing else
 *   DWW-4  one concurrency group, never cancelled
 *   DWW-5  the probe checks out without credentials, keeps no npm cache,
 *          installs without lifecycle scripts, runs an entry that exists, and
 *          uploads the files it writes
 *   DWW-6  no probe step gets a token or a secret
 *   DWW-7  the report job needs the probe, skips a dry run, and only
 *          downloads the files and updates the issue
 *   DWW-8  the issue step checks the verdict, picks only an issue the
 *          workflow opened, opens or edits it on fail or error, and closes
 *          it on pass or no-candidate
 *   DWW-9  Dependabot's npm run comes after the watch on its day
 */

import { parse } from 'yaml';

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
  `gh label create ${LABEL} --force`,
  `gh issue list --label ${LABEL} --state open --limit 100 --json number,author`,
  '[.[] | select(.author.login == "app/github-actions")][0].number // empty',
  'fail | error)',
  'gh issue edit "$number" --body-file "$dir/report.md"',
  `gh issue create --title 'Dev-tooling watch' --label ${LABEL} --body-file "$dir/report.md"`,
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

describe('DevToolingWatchWiring', () => {
  it('[DWW-1] runs daily at 03:00 UTC and by hand, never on a PR or push', () => {
    const triggers = Object.keys(WORKFLOW.on).sort();
    expect(triggers).toEqual(['schedule', 'workflow_dispatch']);
    expect(WORKFLOW.on.schedule).toEqual([{ cron: `0 ${String(WATCH_HOUR)} * * *` }]);
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

  it('[DWW-7] the report job needs the probe, skips a dry run, and runs nothing it downloads', () => {
    expect(REPORT.needs).toBe('probe');
    expect(REPORT.if).toBe(NOT_DRY_RUN);
    const steps = REPORT.steps.map(stepId);
    expect(steps).toEqual(REPORT_STEPS);
    const [download] = REPORT.steps;
    expect(download.with).toMatchObject({ name: ARTIFACT });
    const script = issueScript();
    expect(script).not.toMatch(/\b(?:npm|npx|node)\b/u);
  });

  it.each(ISSUE_COMMANDS)('[DWW-8] the issue step runs %s', command => {
    const script = issueScript();
    expect(script).toContain(command);
  });

  it('[DWW-9] Dependabot opens npm updates after the watch has run that day', () => {
    const schedule = npmSchedule();
    expect(schedule.timezone).toBe('UTC');
    const [hour] = (schedule.time ?? '00:00').split(':');
    const dependabotHour = Number(hour);
    expect(dependabotHour).toBeGreaterThan(WATCH_HOUR);
  });
});
