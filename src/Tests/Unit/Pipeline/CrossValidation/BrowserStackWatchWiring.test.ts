/**
 * Weekly browser-stack watch wiring (`browser-stack-watch.yml`).
 *
 * <p>The workflow holds `issues: write`, so it must run only on its schedule
 * or by hand, never on a PR, and touch only one issue: open, labelled
 * `browser-stack`, and opened by the workflow itself. It edits that body and
 * never comments, so a re-run replaces the report. A manual run is a dry run
 * unless `dry_run` is cleared. Which pairs the watch runs, and in which gate
 * mode, is pinned by the watch's unit test (`BrowserStackWatch.test.ts`).
 *
 * Rules:
 *   BWW-1  the triggers are exactly a Monday 06:00 UTC schedule and a dispatch
 *   BWW-2  a dispatch takes a boolean `dry_run`, true by default
 *   BWW-3  the root grants nothing; the one job reads contents, writes issues
 *   BWW-4  one concurrency group, never cancelled
 *   BWW-5  checkout without credentials, Node from `.nvmrc`, install without
 *          lifecycle scripts, the watch, then the issue update
 *   BWW-6  the watch writes the report the issue step reads, and runs an
 *          entry that exists and git does not ignore
 *   BWW-7  only the issue step is conditional: not on a dry run, read from
 *          the boolean `inputs` context
 *   BWW-8  the issue step edits or creates by label, picks only an issue the
 *          workflow opened, and never comments
 *   BWW-9  no run step interpolates an expression; only the watch and the
 *          issue step get the token
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/browser-stack-watch.yml');
const WORKFLOW_TEXT = readFileSync(WORKFLOW_PATH, 'utf8');

const ENTRY = 'scripts/browser-stack-watch.mjs';
const REPORT = '"$RUNNER_TEMP/browser-stack-watch.md"';
const LABEL = 'browser-stack';
const WATCH_STEP = 'Watch the browser stack';
const ISSUE_STEP = 'Update the watch issue';
const EXPRESSION_OPEN = '$' + '{{';
const NOT_DRY_RUN = `${EXPRESSION_OPEN} !inputs.dry_run }}`;
const TOKEN = `${EXPRESSION_OPEN} github.token }}`;

/** The steps, by the action each uses or else by name. */
const EXPECTED_STEPS = [
  'actions/checkout',
  'actions/setup-node',
  'Install without lifecycle scripts',
  WATCH_STEP,
  ISSUE_STEP,
];

/** The issue step's commands, line continuations joined. */
const ISSUE_COMMANDS = {
  label: `gh label create ${LABEL} --force`,
  find: `gh issue list --label ${LABEL} --state open --limit 100 --json number,author`,
  ownIssue: '[.[] | select(.author.login == "app/github-actions")][0].number // empty',
  edit: `gh issue edit "$number" --body-file ${REPORT}`,
  create: `gh issue create --title 'Browser stack watch' --label ${LABEL} --body-file ${REPORT}`,
};

/** Anything that would add a comment instead of editing the body. */
const COMMENTING = /gh issue comment|\/comments|gh api/u;

/** git without the hook's `GIT_*` variables, so it reads this checkout. */
const ENV_ENTRIES = Object.entries(process.env);
const CLEAN_ENTRIES = ENV_ENTRIES.filter(([key]): boolean => !key.startsWith('GIT_'));
const CLEAN_ENV = Object.fromEntries(CLEAN_ENTRIES);

interface IStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
}

interface IJob {
  readonly permissions?: unknown;
  readonly steps: readonly IStep[];
}

interface IDispatchInput {
  readonly type?: string;
  readonly default?: unknown;
}

interface ITriggers {
  readonly schedule?: readonly { readonly cron: string }[];
  readonly workflow_dispatch?: { readonly inputs?: Readonly<Record<string, IDispatchInput>> };
}

interface IWorkflow {
  readonly on: ITriggers;
  readonly permissions?: unknown;
  readonly concurrency?: unknown;
  readonly jobs: Readonly<Record<string, IJob>>;
}

const WORKFLOW = parse(WORKFLOW_TEXT) as IWorkflow;
/** The workflow without its comments, which may name what it must not use. */
const WORKFLOW_CONTENT = JSON.stringify(WORKFLOW);
const JOBS = Object.values(WORKFLOW.jobs);
const [JOB] = JOBS;
const STEPS = JOB.steps;

/**
 * How {@link EXPECTED_STEPS} names a step.
 *
 * @param step - Workflow step.
 * @returns The action it uses without its ref, or else its name.
 */
function stepId(step: IStep): string {
  const action = step.uses?.split('@')[0];
  return action ?? step.name ?? '';
}

/**
 * One step by name.
 *
 * @param name - Step name.
 * @returns The step; an empty one when no step has that name.
 */
function stepNamed(name: string): IStep {
  return STEPS.find((step): boolean => step.name === name) ?? {};
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
 * The script of one step by name, line continuations joined.
 *
 * @param name - Step name.
 * @returns One line per command.
 */
function scriptNamed(name: string): string {
  const step = stepNamed(name);
  return scriptOf(step);
}

/**
 * Whether a step's environment carries the workflow token.
 *
 * @param step - Workflow step.
 * @returns True when any of its env values is the token.
 */
function getsToken(step: IStep): boolean {
  const values = Object.values(step.env ?? {});
  return values.includes(TOKEN);
}

describe('BrowserStackWatchWiring', () => {
  it('[BWW-1] runs on a Monday 06:00 UTC schedule and by hand, never on a PR or push', () => {
    const triggers = Object.keys(WORKFLOW.on).sort();
    expect(triggers).toEqual(['schedule', 'workflow_dispatch']);
    expect(WORKFLOW.on.schedule).toEqual([{ cron: '0 6 * * 1' }]);
  });

  it('[BWW-2] a manual run is a dry run unless dry_run is cleared', () => {
    const inputs = WORKFLOW.on.workflow_dispatch?.inputs;
    const names = Object.keys(inputs ?? {});
    expect(names).toEqual(['dry_run']);
    expect(inputs?.dry_run).toMatchObject({ type: 'boolean', default: true });
  });

  it('[BWW-3] the root grants nothing and the one job reads contents and writes issues', () => {
    expect(WORKFLOW.permissions).toEqual({});
    expect(JOBS).toHaveLength(1);
    expect(JOB.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('[BWW-4] runs in one group and never cancels a run in progress', () => {
    expect(WORKFLOW.concurrency).toEqual({
      group: 'browser-stack-watch',
      'cancel-in-progress': false,
    });
  });

  it('[BWW-5] checks out without credentials and installs without lifecycle scripts', () => {
    const ids = STEPS.map(stepId);
    const [checkout, setupNode, install] = STEPS;
    expect(ids).toEqual(EXPECTED_STEPS);
    expect(checkout.with).toEqual({ 'persist-credentials': false });
    expect(setupNode.with).toMatchObject({ 'node-version-file': '.nvmrc' });
    expect(install.run).toBe('npm ci --ignore-scripts --no-audit --no-fund');
  });

  it('[BWW-6] the watch writes the report the issue step reads, from a tracked entry', () => {
    const watch = scriptNamed(WATCH_STEP);
    const update = scriptNamed(ISSUE_STEP);
    const bodyFiles = update.match(/--body-file \S+/gu);
    const entryPath = join(REPO_ROOT, ENTRY);
    const ignore = spawnSync('git', ['check-ignore', '-q', '--no-index', ENTRY], {
      cwd: REPO_ROOT,
      env: CLEAN_ENV,
    });
    expect(watch).toContain(`node ${ENTRY} --out ${REPORT}`);
    expect(bodyFiles).toEqual([`--body-file ${REPORT}`, `--body-file ${REPORT}`]);
    const hasEntry = existsSync(entryPath);
    expect(hasEntry).toBe(true);
    expect(ignore.status).toBe(1);
  });

  it('[BWW-7] only the issue step is conditional, and it skips a dry run', () => {
    const conditions = STEPS.map((step): string => step.if ?? 'always');
    expect(conditions).toEqual(['always', 'always', 'always', 'always', NOT_DRY_RUN]);
    expect(WORKFLOW_CONTENT).not.toContain('github.event.inputs');
  });

  it('[BWW-8] edits or creates the labelled issue the workflow opened, and never comments', () => {
    const update = scriptNamed(ISSUE_STEP);
    const scripts = STEPS.map(scriptOf).join('\n');
    expect(update).toContain(ISSUE_COMMANDS.label);
    expect(update).toContain(ISSUE_COMMANDS.find);
    expect(update).toContain(ISSUE_COMMANDS.ownIssue);
    expect(update).toContain(ISSUE_COMMANDS.edit);
    expect(update).toContain(ISSUE_COMMANDS.create);
    expect(scripts).not.toMatch(COMMENTING);
  });

  it('[BWW-9] no script interpolates an expression; only the watch and the update get the token', () => {
    const scripts = STEPS.map(scriptOf);
    const interpolating = scripts.filter((script): boolean => script.includes(EXPRESSION_OPEN));
    const tokenSteps = STEPS.filter(getsToken).map(stepId);
    const watch = stepNamed(WATCH_STEP);
    expect(interpolating).toEqual([]);
    expect(tokenSteps).toEqual([WATCH_STEP, ISSUE_STEP]);
    expect(watch.env).toEqual({ GITHUB_TOKEN: TOKEN });
  });
});
