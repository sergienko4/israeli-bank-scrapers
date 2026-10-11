/**
 * Docs staleness gate.
 *
 * <p>`.github/scripts/ci/docs-staleness.sh` fails a pull request that changes a
 * file bound to a docs page by its `source-files:` front-matter without
 * changing a page bound to it. Bindings reach beyond `src/` — workflows, CI
 * scripts and package manifests are bound too — so the gate's steps in the
 * `Static checks` job run on every pull request, behind no path filter, and
 * the merge-blocking `Validate` aggregator waits for that job.
 *
 * <p>Bot PRs are exempt through the same `is-bot-pr.cjs` predicate the PR-body
 * gates use: a bot cannot update the bound page. What this test pins is that
 * the gate stays a gate — it runs on every pull request, `Validate` fails when
 * it fails or is cancelled, it cannot swallow its own failure, it runs exactly
 * once, and it skips only what the shared predicate calls a bot PR. The job
 * references no repository secret, and the bot check runs as a plain `node`
 * step, so the pull request's code it loads receives no token. The job's own
 * fields are fixed, which keeps it on a GitHub-hosted `ubuntu-latest` runner
 * with no container or services, and the `env:` keys the workflow and the job
 * declare are allowlisted, so no preload declared there runs code ahead of the
 * pinned steps.
 *
 * <p>The gate's steps are pinned whole, and the code of the bot script and the
 * aggregator's step line for line: finite cases and fragment checks cannot
 * rule out an extra skip condition, a decoy step, a moved working directory,
 * or a script that keeps the right lines behind an early exit. Changing any of
 * them on purpose means updating its pin here.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');

/**
 * YAML key of the job the gate's steps run in, of the job it waits for, and of
 * the aggregator that decides what can block a merge.
 */
const GATE_JOB_KEY = 'static-checks';
const CHANGES_JOB_KEY = 'changes';
const VALIDATE_JOB_KEY = 'validate';

/** Only pull-request events carry a base to diff against; no `src/` filter. */
const GATE_CONDITION = "github.event_name == 'pull_request'";

/** The scan runs unless the bot step reported a bot PR. */
const SKIP_CONDITION = "steps.bot.outputs.skip != 'true'";
const BOT_STEP_ID = 'bot';

/** Longest either gate step may run; each takes seconds. */
const STEP_MINUTES = 10;

/** How the gate job invokes its script, and the name any invocation contains. */
const GATE_COMMAND = 'bash .github/scripts/ci/docs-staleness.sh';
const GATE_SCRIPT_NAME = 'docs-staleness.sh';

/** The pull request's base, which the script diffs the merge commit against. */
const BASE_ENV = {
  BASE_REF: '${{ github.event.pull_request.base.ref }}',
  BASE_SHA: '${{ github.event.pull_request.base.sha }}',
};

/**
 * The only variables the gate inherits from the workflow and its job. An
 * allowlist, so a preload such as `BASH_ENV` or `NODE_OPTIONS` cannot run code
 * ahead of the pinned steps.
 */
const INHERITED_ENV_KEYS = ['FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'];

/** How the bot step runs its script: plain `node`, which hands it no token. */
const BOT_COMMAND = 'node .github/scripts/ci/docs-staleness-bot-skip.cjs';
const BOT_SKIP_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/docs-staleness-bot-skip.cjs');

/** Where {@link runBotSkip} makes the throwaway directory for each run. */
const TEMP_ROOT = tmpdir();
const BOT_TMP_PREFIX = join(TEMP_ROOT, 'docs-staleness-bot-');

/**
 * The bot step, pinned whole: no `uses`, `with` or `env` can hand it a token
 * or extra input, and its `if:` is the pull-request condition alone, so no
 * extra skip condition can hide there.
 */
const BOT_STEP = {
  name: 'Skip bot PRs',
  if: GATE_CONDITION,
  'timeout-minutes': STEP_MINUTES,
  id: BOT_STEP_ID,
  run: BOT_COMMAND,
};

/**
 * The bot script's code below its header comment, as {@link scriptLines}.
 * Pinned whole because the pull-request cases below are finite: they cannot
 * show that the shared predicate is the only way to `skip=true` — an extra
 * condition would pass them. An intended edit updates this pin.
 */
const BOT_SKIP_CODE = [
  "const fs = require('node:fs');",
  "const isBotPr = require('./is-bot-pr.cjs');",
  "const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));",
  'const pr = event.pull_request;',
  "const skip = isBotPr(pr) ? 'true' : 'false';",
  "if (skip === 'true') {",
  "console.log(`Docs staleness skipped — bot PR (author='${pr.user?.login ?? ''}').`);",
  '}',
  'fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\\n`);',
];

/** The comment delimiters the bot script's header must open and close with. */
const BOT_SKIP_HEADER = { opens: '/**', closes: '*/' };

/**
 * The shell every `run:` step gets. A job or step that overrides it could run
 * the gate's command as a no-op, so neither job may.
 */
const STRICT_DEFAULTS = { run: { shell: 'bash --noprofile --norc -euo pipefail {0}' } };

/** Longest the gate job may run; the scan itself takes seconds. */
const MAX_GATE_MINUTES = 15;

/** A pinned action reference: owner/name at a full commit SHA. */
const PINNED_CHECKOUT = /^actions\/checkout@[0-9a-f]{40}$/;

/**
 * The checkout step's only inputs: full history, and no stored credential.
 * Pinned whole, so no `ref`, `path`, `sparse-checkout` or `env` can change
 * what the scan reads.
 */
const CHECKOUT_INPUTS = { 'fetch-depth': 0, 'persist-credentials': false };

/**
 * The scan step, pinned whole: no `working-directory`, `shell` or
 * `continue-on-error` can point it elsewhere or let it pass on failure. It
 * runs in the background, beside the job's other steps.
 */
const SCAN_STEP = {
  name: 'Docs staleness canary',
  if: `${GATE_CONDITION} && ${SKIP_CONDITION}`,
  background: true,
  'timeout-minutes': STEP_MINUTES,
  env: BASE_ENV,
  run: GATE_COMMAND,
};

/**
 * The job's last step, pinned whole. A failed background step fails the job
 * only at a `wait-all` that includes it, so this is where a failed scan blocks.
 */
const WAIT_ALL_STEP = { name: 'Wait for the background gates', 'wait-all': null };

/** The runner the gate needs: GitHub-hosted, so no self-hosted state leaks in. */
const HOSTED_RUNNER = 'ubuntu-latest';

/**
 * The gate job's only fields. An allowlist, so no `container`, `services`,
 * `strategy`, `defaults` or job-level `if` can change where or whether it runs.
 */
const GATE_JOB_FIELDS = [
  'name',
  'needs',
  'runs-on',
  'timeout-minutes',
  'env',
  'permissions',
  'steps',
];

/**
 * Any expression that would hand the job a secret or a token: the `secrets`
 * context however it is indexed or passed; `github.token`; any key lookup on
 * `github`, or the whole `github` context passed on, either of which can reach
 * the token; or a token variable. Expression names are case-insensitive.
 */
const CREDENTIAL = /\bsecrets\b|\bgithub\s*(?:\.\s*token|[),[}])|GH_TOKEN|GITHUB_TOKEN/i;

/** The trigger: every pull request into main, with no event-type or path filter. */
const PR_TRIGGER = { branches: ['main'] };

/** Every account the shared predicate treats as automation. */
const BOT_LOGINS = [
  'dependabot[bot]',
  'renovate[bot]',
  'release-please[bot]',
  'github-actions[bot]',
];

/** A branch name no bot prefix covers, so only the author decides the skip. */
const PLAIN_BRANCH = 'chore/x';

/** A maintainer, who can push branches to the base repository. */
const MAINTAINER = 'a-maintainer';

/**
 * The aggregator must run even when a job it needs failed: under the default
 * `success()` it would be skipped, and a skipped required check counts as passed.
 */
const AGGREGATOR_CONDITION = 'always()';

/**
 * The aggregator's only step, its script as {@link scriptLines}. Pinned whole:
 * a guard that looks for fragments passes a script that keeps them in a
 * comment, or behind an early `exit 0`, or in a decoy step that never runs.
 * An intended edit updates this pin.
 */
const AGGREGATOR_STEP = {
  name: 'Verify all gates green',
  env: { NEEDS_JSON: '${{ toJSON(needs) }}' },
  run: [
    'set -euo pipefail',
    'echo "Aggregator inputs:"',
    'echo "$NEEDS_JSON" | jq -r \'to_entries | map("  \\(.key): \\(.value.result)") | .[]\'',
    'FAILED=$(echo "$NEEDS_JSON" | jq -r \'to_entries | map(select(.value.result == "failure" or .value.result == "cancelled")) | map(.key) | join(",")\')',
    'if [ -n "$FAILED" ]; then',
    'echo "::error::Validate gate FAILED — these jobs reported failure or cancelled: $FAILED"',
    'exit 1',
    'fi',
    'echo "✅ All parallel validate gates green (success or skipped)."',
  ],
};

/** Shell that would let a failing command pass. */
const SWALLOWED_FAILURE = /\|\|\s*(?:true|:)(?![\w-])|set \+e/;

/** Repository names for same-repo and fork pull requests. */
const BASE_REPO = 'owner/repo';
const FORK_REPO = 'fork-owner/repo';

interface IWorkflowStep {
  readonly name?: string;
  readonly id?: string;
  readonly if?: unknown;
  readonly background?: unknown;
  readonly 'timeout-minutes'?: number;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly shell?: unknown;
  readonly 'continue-on-error'?: unknown;
}

interface IWorkflowJob {
  readonly name?: string;
  readonly if?: unknown;
  readonly 'runs-on'?: unknown;
  readonly needs?: readonly string[] | string;
  readonly permissions?: unknown;
  readonly 'timeout-minutes'?: number;
  readonly 'continue-on-error'?: unknown;
  readonly defaults?: unknown;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly steps?: readonly IWorkflowStep[];
}

interface IWorkflowDoc {
  readonly on: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly defaults?: unknown;
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

/** What one run of the bot script reported. */
interface IBotRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

/** The bot script's header delimiters and the code that follows the header. */
interface IBotSkipSource {
  readonly opens: string;
  readonly closes: string;
  readonly code: readonly string[];
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
 * The merge-blocking aggregator job.
 *
 * @returns The job, or an empty job when it is missing.
 */
function validateJob(): IWorkflowJob {
  const doc = loadWorkflow();
  return doc.jobs[VALIDATE_JOB_KEY] ?? { steps: [] };
}

/**
 * The jobs the merge-blocking aggregator waits for.
 *
 * @returns Job keys in its `needs`.
 */
function validateNeeds(): readonly string[] {
  const needs = validateJob().needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * A script as its trimmed, non-blank lines: re-indenting it changes nothing,
 * while adding, removing or editing any line, comments included, does.
 *
 * @param script - Shell or JavaScript source.
 * @returns The lines, in order.
 */
function scriptLines(script: string): readonly string[] {
  const lines = script.split('\n').map(line => line.trim());
  return lines.filter(line => line !== '');
}

/**
 * A copy of a list in a fixed order, so comparing key sets ignores the order
 * the YAML happens to declare them in.
 *
 * @param list - Strings to order.
 * @returns A sorted copy; the input is left untouched.
 */
function sorted(list: readonly string[]): readonly string[] {
  return [...list].sort((left, right) => left.localeCompare(right));
}

/**
 * The aggregator's steps, each `run` script reduced to its lines.
 *
 * @returns Steps in order, comparable to {@link AGGREGATOR_STEP}.
 */
function aggregatorSteps(): readonly unknown[] {
  const steps = validateJob().steps ?? [];
  return steps.map(step => ({ ...step, run: scriptLines(step.run ?? '') }));
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
 * The gate job's bot step.
 *
 * @returns The step, comparable to {@link BOT_STEP}.
 */
function botStep(): IWorkflowStep {
  return gateSteps().find(step => step.id === BOT_STEP_ID) ?? {};
}

/**
 * The gate job's scan step.
 *
 * @returns The step, comparable to {@link SCAN_STEP}.
 */
function scanStep(): IWorkflowStep {
  return gateSteps().find(step => step.run === GATE_COMMAND) ?? {};
}

/**
 * The bot script split at its header comment: the first line must open the
 * header and the first `*` + `/` must close it, so no code can hide in it.
 *
 * @returns The header delimiters and the code after the header, as {@link scriptLines}.
 */
function botSkipSource(): IBotSkipSource {
  const lines = readFileSync(BOT_SKIP_SCRIPT, 'utf8').split('\n');
  const headerEnd = lines.findIndex(line => line.includes('*/'));
  const codeSource = lines.slice(headerEnd + 1).join('\n');
  const code = scriptLines(codeSource);
  return { opens: lines[0].trimEnd(), closes: lines[headerEnd].trim(), code };
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
 * Run the bot script on a payload in `dir`, as the plain `node` step would.
 *
 * @param dir - Throwaway directory for the event and output files.
 * @param payload - The event payload.
 * @returns What the script reported.
 */
function runBotSkipIn(dir: string, payload: unknown): IBotRun {
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output');
  const eventJson = JSON.stringify(payload);
  writeFileSync(eventPath, eventJson, 'utf8');
  writeFileSync(outputPath, '', 'utf8');
  const env = { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath };
  const result = spawnSync(process.execPath, [BOT_SKIP_SCRIPT], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = readFileSync(outputPath, 'utf8');
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, output };
}

/**
 * Run the bot script as a child process on a throwaway event file.
 *
 * @param payload - The event payload.
 * @returns What the script reported.
 */
function runBotSkip(payload: unknown): IBotRun {
  const dir = mkdtempSync(BOT_TMP_PREFIX);
  try {
    return runBotSkipIn(dir, payload);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Each bot account is skipped on its author alone, on a branch no prefix covers. */
const AUTHOR_CASES: readonly IBotCase[] = BOT_LOGINS.map(login => ({
  name: `a PR by ${login} is skipped`,
  pullRequest: makePr(login, PLAIN_BRANCH, BASE_REPO),
  skip: 'true',
}));

/**
 * Branch prefixes are trusted only in the base repository, where pushing a
 * branch already needs write access — so a maintainer's branch there is
 * skipped too, while the same name on a fork, or a `renovate/` name, is not.
 */
const BRANCH_CASES: readonly IBotCase[] = [
  {
    name: 'a release-please branch in this repo is skipped',
    pullRequest: makePr(MAINTAINER, 'release-please--branches--main', BASE_REPO),
    skip: 'true',
  },
  {
    name: 'a Dependabot branch in this repo is skipped, whoever pushed it',
    pullRequest: makePr(MAINTAINER, 'dependabot/npm_and_yarn/x', BASE_REPO),
    skip: 'true',
  },
  {
    name: 'a human PR is scanned',
    pullRequest: makePr(MAINTAINER, 'ci/some-change', BASE_REPO),
    skip: 'false',
  },
  {
    name: 'a renovate branch pushed by a human is scanned',
    pullRequest: makePr(MAINTAINER, 'renovate/lock-file-maintenance', BASE_REPO),
    skip: 'false',
  },
  {
    name: 'a fork branch named like a Dependabot branch is scanned',
    pullRequest: makePr('a-contributor', 'dependabot/npm_and_yarn/x', FORK_REPO),
    skip: 'false',
  },
  {
    name: 'a fork branch named like a release-please branch is scanned',
    pullRequest: makePr('a-contributor', 'release-please--branches--main', FORK_REPO),
    skip: 'false',
  },
];

const BOT_CASES: readonly IBotCase[] = [...AUTHOR_CASES, ...BRANCH_CASES];

describe('Docs staleness gate', () => {
  /**
   * The job waits for `changes` only for its other steps: neither gate step
   * reads an output of it, and `Validate` needs `changes` too, so a failed
   * `changes` fails the merge instead of silently skipping the gate.
   */
  it('[DSG-1] runs on every pull request, not only when src/ changes', () => {
    const job = gateJob();
    const bot = botStep();
    const scan = scanStep();
    const needs = validateNeeds();
    expect(job.if).toBeUndefined();
    expect(job.needs).toBe(CHANGES_JOB_KEY);
    expect(bot.if).toBe(GATE_CONDITION);
    expect(scan.if).toBe(`${GATE_CONDITION} && ${SKIP_CONDITION}`);
    expect(needs).toContain(CHANGES_JOB_KEY);
  });

  it('[DSG-2] holds read-only repository access', () => {
    const job = gateJob();
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('[DSG-3] checks out, then decides the bot skip, then scans, then waits for the scan', () => {
    const steps = gateSteps();
    const [checkout] = steps;
    const bot = steps.findIndex(step => step.id === BOT_STEP_ID);
    const scan = steps.findIndex(step => step.run === GATE_COMMAND);
    const last = steps.at(-1);
    expect(checkout.uses).toMatch(PINNED_CHECKOUT);
    expect(bot).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(bot);
    expect(last).toStrictEqual(WAIT_ALL_STEP);
  });

  it('[DSG-4] checks out full history with no stored credential', () => {
    const [checkout] = gateSteps();
    const { uses, ...rest } = checkout;
    expect(uses).toMatch(PINNED_CHECKOUT);
    expect(rest).toStrictEqual({ with: CHECKOUT_INPUTS });
  });

  it('[DSG-5] decides the bot skip in a plain node step that holds no token', () => {
    const bot = botStep();
    expect(bot.uses).toBeUndefined();
    expect(bot.with).toBeUndefined();
    expect(bot.env).toBeUndefined();
    expect(bot.run).toBe(BOT_COMMAND);
  });

  it('[DSG-6] scans unless the bot step skipped, against the PR base', () => {
    const scan = scanStep();
    expect(scan).toStrictEqual(SCAN_STEP);
  });

  it('[DSG-7] can block the merge', () => {
    const needs = validateNeeds();
    expect(needs).toContain(GATE_JOB_KEY);
  });

  it('[DSG-8] is the only place the workflow runs the staleness script', () => {
    const invocations = gateInvocations();
    expect(invocations).toEqual([GATE_COMMAND]);
  });

  /**
   * Other steps of the job may tolerate their own failure — the informational
   * audit, an optional fetch — so only the gate's own steps, the wait-all that
   * surfaces the scan, and the job are held to it. No step of the job, gate or
   * not, may reference a credential.
   */
  it('[DSG-9] cannot pass by ignoring its own failure or reference a secret', () => {
    const workflow = loadWorkflow();
    const job = gateJob();
    const gate = [botStep(), scanStep(), gateSteps().at(-1) ?? {}];
    const lenientSteps = gate.filter(step => step['continue-on-error'] !== undefined);
    const gateSource = JSON.stringify({ env: workflow.env, gate });
    const inReach = JSON.stringify({ env: workflow.env, job });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(MAX_GATE_MINUTES);
    expect(job['continue-on-error']).toBeUndefined();
    expect(lenientSteps).toEqual([]);
    expect(gateSource).not.toMatch(SWALLOWED_FAILURE);
    expect(inReach).not.toMatch(CREDENTIAL);
  });

  it.each(BOT_CASES)('[DSG-10] $name', ({ pullRequest, skip }) => {
    const run = runBotSkip({ pull_request: pullRequest });
    const login = pullRequest.user.login;
    const logged = `Docs staleness skipped — bot PR (author='${login}').\n`;
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.output).toBe(`skip=${skip}\n`);
    expect(run.stdout).toBe(skip === 'true' ? logged : '');
  });

  it('[DSG-11] triggers on every pull request into main, with no type or path filter', () => {
    const doc = loadWorkflow();
    expect(doc.on.pull_request).toEqual(PR_TRIGGER);
  });

  it('[DSG-12] Validate fails when any job it needs fails or is cancelled', () => {
    const job = validateJob();
    const steps = aggregatorSteps();
    expect(job.if).toBe(AGGREGATOR_CONDITION);
    expect(job['continue-on-error']).toBeUndefined();
    expect(job.defaults).toBeUndefined();
    expect(steps).toStrictEqual([AGGREGATOR_STEP]);
  });

  it('[DSG-13] skips only on the shared predicate verdict', () => {
    const step = botStep();
    const source = botSkipSource();
    expect(step).toStrictEqual(BOT_STEP);
    expect(source).toStrictEqual({ ...BOT_SKIP_HEADER, code: BOT_SKIP_CODE });
  });

  it('[DSG-14] runs its commands under the strict workflow shell', () => {
    const doc = loadWorkflow();
    const job = gateJob();
    const steps = gateSteps();
    const overrides = steps.filter(step => step.shell !== undefined);
    expect(doc.defaults).toStrictEqual(STRICT_DEFAULTS);
    expect(job.defaults).toBeUndefined();
    expect(overrides).toEqual([]);
  });

  it('[DSG-15] fails, rather than skips, on an event without a pull request', () => {
    const run = runBotSkip({});
    expect(run.status).not.toBe(0);
    expect(run.output).toBe('');
  });

  it('[DSG-16] declares no workflow or job env beyond the allowlist', () => {
    const workflow = loadWorkflow();
    const job = gateJob();
    const inherited = { ...workflow.env, ...job.env };
    const keys = Object.keys(inherited);
    const actual = sorted(keys);
    const allowed = sorted(INHERITED_ENV_KEYS);
    expect(actual).toEqual(allowed);
  });

  it('[DSG-17] runs on a GitHub-hosted runner, with no container or services', () => {
    const job = gateJob();
    const fields = Object.keys(job);
    const actual = sorted(fields);
    const allowed = sorted(GATE_JOB_FIELDS);
    expect(job['runs-on']).toBe(HOSTED_RUNNER);
    expect(actual).toEqual(allowed);
  });
});
