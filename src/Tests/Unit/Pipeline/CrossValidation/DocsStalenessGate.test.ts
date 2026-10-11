/**
 * Docs staleness gate.
 *
 * <p>`.github/scripts/ci/docs-staleness.sh` fails a pull request that changes a
 * file bound to a docs page by its `source-files:` front-matter without
 * changing a page bound to it. Bindings reach beyond `src/` — workflows, CI
 * scripts and package manifests are bound too — so the gate runs as its own
 * job on every pull request rather than behind the `src/` path filter, and the
 * merge-blocking `Validate` aggregator waits for it.
 *
 * <p>Bot PRs are exempt through the same `is-bot-pr.cjs` predicate the PR-body
 * gates use: a bot cannot update the bound page. What this test pins is that
 * the gate stays a gate — it runs on every pull request, can block the merge,
 * cannot swallow its own failure, holds no credential, runs exactly once, and
 * skips only what the shared predicate calls a bot PR.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');

/** The checkout root GitHub hands the bot step, without a trailing separator. */
const WORKSPACE = REPO_ROOT.replace(/[\\/]+$/, '');

/** YAML key of the gate job, and of the aggregator that decides what can block a merge. */
const GATE_JOB_KEY = 'docs-staleness';
const VALIDATE_JOB_KEY = 'validate';

/** Only pull-request events carry a base to diff against; no `src/` filter. */
const GATE_CONDITION = "github.event_name == 'pull_request'";

/** The scan runs unless the bot step reported a bot PR. */
const SKIP_CONDITION = "steps.bot.outputs.skip != 'true'";
const BOT_STEP_ID = 'bot';

/** How the gate job invokes its script, and the name any invocation contains. */
const GATE_COMMAND = 'bash .github/scripts/ci/docs-staleness.sh';
const GATE_SCRIPT_NAME = 'docs-staleness.sh';

/** The pull request's base, which the script diffs the merge commit against. */
const BASE_ENV = {
  BASE_REF: '${{ github.event.pull_request.base.ref }}',
  BASE_SHA: '${{ github.event.pull_request.base.sha }}',
};

/** The shared predicate the bot step must load, rather than an inline copy. */
const BOT_PREDICATE = '/.github/scripts/ci/is-bot-pr.cjs';

/** Longest the gate job may run; the scan itself takes seconds. */
const MAX_GATE_MINUTES = 15;

/** A pinned action reference: owner/name at a full commit SHA. */
const PINNED_CHECKOUT = /^actions\/checkout@[0-9a-f]{40}$/;

/** The github-script commit every bot step in the repo runs. */
const GITHUB_SCRIPT = 'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3';

/** Anything that would hand a credential to the job. */
const CREDENTIAL = /secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN/;

/** Shell that would let a failing command pass. */
const SWALLOWED_FAILURE = /\|\|\s*(?:true|:)(?![\w-])|set \+e/;

/** Repository names for same-repo and fork pull requests. */
const BASE_REPO = 'owner/repo';
const FORK_REPO = 'fork-owner/repo';

const LOAD_COMMON_JS = createRequire(import.meta.url);

interface IWorkflowStep {
  readonly id?: string;
  readonly if?: unknown;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly env?: unknown;
  readonly 'continue-on-error'?: unknown;
}

interface IWorkflowJob {
  readonly if?: unknown;
  readonly needs?: readonly string[] | string;
  readonly permissions?: unknown;
  readonly 'timeout-minutes'?: number;
  readonly 'continue-on-error'?: unknown;
  readonly steps?: readonly IWorkflowStep[];
}

interface IWorkflowDoc {
  readonly env?: unknown;
  readonly jobs: Readonly<Record<string, IWorkflowJob>>;
}

/** The `pull_request` payload fields the bot predicate reads. */
interface IPullRequest {
  readonly user: { readonly login: string };
  readonly head: { readonly ref: string; readonly repo: { readonly full_name: string } };
  readonly base: { readonly repo: { readonly full_name: string } };
}

/** A pull request, and the `skip` output the bot step must set for it. */
interface IBotCase {
  readonly name: string;
  readonly pullRequest: IPullRequest;
  readonly skip: string;
}

/** What one run of the bot step reported: outputs, modules loaded and log lines. */
interface IBotRun {
  readonly outputs: Map<string, string>;
  readonly loaded: string[];
  readonly infos: string[];
}

/** The part of github-script's `core` the bot step uses. */
interface IRecordingCore {
  readonly info: (message: string) => number;
  readonly setOutput: (key: string, value: string) => Map<string, string>;
}

/**
 * Parse the pull-request workflow.
 *
 * @returns Parsed workflow.
 */
function loadWorkflow(): IWorkflowDoc {
  const text = readFileSync(PR_YAML, 'utf8');
  return parse(text) as IWorkflowDoc;
}

/**
 * The gate job of the pull-request workflow.
 *
 * @returns The job, or an empty job when it is missing.
 */
function gateJob(): IWorkflowJob {
  const doc = loadWorkflow();
  return doc.jobs[GATE_JOB_KEY] ?? { steps: [] };
}

/**
 * The gate job's steps.
 *
 * @returns Steps in order, or none when the job is missing.
 */
function gateSteps(): readonly IWorkflowStep[] {
  return gateJob().steps ?? [];
}

/**
 * The jobs the merge-blocking aggregator waits for.
 *
 * @returns Job keys in its `needs`.
 */
function validateNeeds(): readonly string[] {
  const doc = loadWorkflow();
  const needs = doc.jobs[VALIDATE_JOB_KEY].needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * Every step in the pull-request workflow that runs the staleness script.
 *
 * @returns The steps' `run` commands, across all jobs.
 */
function gateInvocations(): readonly string[] {
  const doc = loadWorkflow();
  const steps = Object.values(doc.jobs).flatMap(job => job.steps ?? []);
  const commands = steps.map(step => step.run ?? '');
  return commands.filter(command => command.includes(GATE_SCRIPT_NAME));
}

/**
 * The bot step's inline github-script body.
 *
 * @returns Script source, or empty when the step carries none.
 */
function botScript(): string {
  const bot = gateSteps().find(step => step.id === BOT_STEP_ID);
  const script = bot?.with?.script;
  return typeof script === 'string' ? script : '';
}

/**
 * A `pull_request` payload against {@link BASE_REPO}.
 *
 * @param login - Author login.
 * @param ref - Head branch name.
 * @param headRepo - Full name of the repository the head branch lives in.
 * @returns The payload.
 */
function makePr(login: string, ref: string, headRepo: string): IPullRequest {
  const head = { ref, repo: { full_name: headRepo } };
  const base = { repo: { full_name: BASE_REPO } };
  return { user: { login }, head, base };
}

/**
 * A `require` that records each module id before loading it.
 *
 * @param run - Recorder for modules loaded.
 * @returns The recording loader.
 */
function recordingRequire(run: IBotRun): (id: string) => unknown {
  return (id: string): unknown => {
    run.loaded.push(id);
    return LOAD_COMMON_JS(id);
  };
}

/**
 * A github-script `core` that records each output and log line.
 *
 * @param run - Recorder for outputs set and lines logged.
 * @returns The recording `core`.
 */
function recordingCore(run: IBotRun): IRecordingCore {
  return {
    /**
     * Record a log line.
     *
     * @param message - The line logged.
     * @returns How many lines are recorded.
     */
    info: (message: string): number => run.infos.push(message),
    /**
     * Record a step output.
     *
     * @param key - The output name.
     * @param value - The output value.
     * @returns The outputs recorded so far.
     */
    setOutput: (key: string, value: string): Map<string, string> => run.outputs.set(key, value),
  };
}

/**
 * The globals github-script gives a step, recording what the step does.
 *
 * @param pr - The `pull_request` payload.
 * @param run - Recorder for outputs set, modules loaded and lines logged.
 * @returns The sandbox.
 */
function makeSandbox(pr: IPullRequest, run: IBotRun): vm.Context {
  const core = recordingCore(run);
  const env = { GITHUB_WORKSPACE: WORKSPACE };
  const payload = { pull_request: pr };
  return { context: { payload }, core, require: recordingRequire(run), process: { env } };
}

/**
 * Run the bot step's script as github-script would, inside an async function
 * so its top-level `return` is legal.
 *
 * @param pr - The `pull_request` payload.
 * @returns What the step reported.
 */
async function runBotStep(pr: IPullRequest): Promise<IBotRun> {
  const run: IBotRun = { outputs: new Map(), loaded: [], infos: [] };
  const sandbox = makeSandbox(pr, run);
  const wrapped = `(async () => {\n${botScript()}\n})()`;
  await (vm.runInNewContext(wrapped, sandbox) as Promise<unknown>);
  return run;
}

const BOT_CASES: readonly IBotCase[] = [
  {
    name: 'a Dependabot PR is skipped',
    pullRequest: makePr('dependabot[bot]', 'dependabot/github_actions/x', BASE_REPO),
    skip: 'true',
  },
  {
    name: 'a release-please branch in this repo is skipped',
    pullRequest: makePr('a-maintainer', 'release-please--branches--main', BASE_REPO),
    skip: 'true',
  },
  {
    name: 'a human PR is scanned',
    pullRequest: makePr('a-maintainer', 'ci/some-change', BASE_REPO),
    skip: 'false',
  },
  {
    name: 'a fork branch named like a bot branch is scanned',
    pullRequest: makePr('a-contributor', 'dependabot/npm_and_yarn/x', FORK_REPO),
    skip: 'false',
  },
];

describe('Docs staleness gate', () => {
  it('[DSG-1] runs on every pull request, not only when src/ changes', () => {
    const job = gateJob();
    expect(gateSteps().length).toBeGreaterThan(0);
    expect(job.if).toBe(GATE_CONDITION);
    expect(job.needs).toBeUndefined();
  });

  it('[DSG-2] holds read-only repository access', () => {
    const job = gateJob();
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('[DSG-3] checks out, then decides the bot skip, then scans', () => {
    const steps = gateSteps();
    const [checkout, bot, scan] = steps;
    expect(steps).toHaveLength(3);
    expect(checkout.uses).toMatch(PINNED_CHECKOUT);
    expect(bot.id).toBe(BOT_STEP_ID);
    expect(scan.run).toBe(GATE_COMMAND);
  });

  it('[DSG-4] checks out full history with no stored credential', () => {
    const [checkout] = gateSteps();
    expect(checkout.uses).toMatch(PINNED_CHECKOUT);
    expect(checkout.with?.['fetch-depth']).toBe(0);
    expect(checkout.with?.['persist-credentials']).toBe(false);
    expect(checkout.with?.ref).toBeUndefined();
  });

  it('[DSG-5] decides the bot skip with the pinned github-script', () => {
    const [, bot] = gateSteps();
    expect(bot.uses).toBe(GITHUB_SCRIPT);
  });

  it('[DSG-6] scans unless the bot step skipped, against the PR base', () => {
    const [, , scan] = gateSteps();
    expect(scan.if).toBe(SKIP_CONDITION);
    expect(scan.env).toEqual(BASE_ENV);
  });

  it('[DSG-7] can block the merge', () => {
    const needs = validateNeeds();
    expect(needs).toContain(GATE_JOB_KEY);
  });

  it('[DSG-8] is the only place the workflow runs the staleness script', () => {
    const invocations = gateInvocations();
    expect(invocations).toEqual([GATE_COMMAND]);
  });

  it('[DSG-9] cannot pass by ignoring its own failure or reach a credential', () => {
    const workflow = loadWorkflow();
    const job = gateJob();
    const lenientSteps = gateSteps().filter(step => step['continue-on-error'] !== undefined);
    const inReach = JSON.stringify({ env: workflow.env, job });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(MAX_GATE_MINUTES);
    expect(job['continue-on-error']).toBeUndefined();
    expect(lenientSteps).toEqual([]);
    expect(inReach).not.toMatch(SWALLOWED_FAILURE);
    expect(inReach).not.toMatch(CREDENTIAL);
  });

  it.each(BOT_CASES)('[DSG-10] $name', async ({ pullRequest, skip }) => {
    const run = await runBotStep(pullRequest);
    const keys = [...run.outputs.keys()];
    const skipOutput = run.outputs.get('skip');
    expect(run.loaded).toEqual([`${WORKSPACE}${BOT_PREDICATE}`]);
    expect(keys).toEqual(['skip']);
    expect(skipOutput).toBe(skip);
  });
});
