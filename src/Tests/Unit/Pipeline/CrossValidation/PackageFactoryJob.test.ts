/**
 * Package & E2E factory job.
 *
 * <p>`Package & E2E factory` in `pr.yml` runs four gates that used to be jobs
 * of their own — the build and dry-run publish, the consumer install, the E2E
 * factory tests and the memory regression gate — on one runner, so a push
 * stays inside the account's concurrent-job limit.
 *
 * <p>The order is load-bearing. E2E factory imports `src/`, not `lib/`, so it
 * is the only background step. The package chain stays in the foreground and
 * in order, because `npm pack` runs `prepare`, which rebuilds `lib/`: beside
 * the upload it would rewrite `lib/` while it is uploaded. Memory runs after
 * `wait-all`, alone, so its PR-vs-merge-base comparison sees no sibling load,
 * and it needs full history, or its base checkout fails and the gate skips
 * its comparison while staying green.
 *
 * <p>Each moved step keeps its old job's condition, time limit, env and
 * command, pinned whole here; the job's `if:` must stay the union of its
 * steps' flags, or a step could be gated on a flag that never starts the job.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');

const JOB_KEY = 'package-factory';
const STATIC_CHECKS_JOB_KEY = 'static-checks';
const VALIDATE_JOB_KEY = 'validate';

/** The jobs folded into the two merged jobs; none may come back. */
const FOLDED_JOB_KEYS = [
  'lint-and-types',
  'scorecard-npm-pins',
  'bank-coverage',
  'decoupling',
  'docs-staleness',
  'build',
  'consumer-install',
  'e2e-factory',
  'memory',
];

const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_TEST_RUNNER = '$/.github/actions/setup-test-runner';
const BUILD_PACKAGE = '$/.github/actions/build-package';
const UPLOAD_ARTIFACT = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9';

const FULL_SUITE = "needs.changes.outputs.full_suite == 'true'";
const PUBLIC_SURFACE = "needs.changes.outputs.public_surface == 'true'";
const DEPS = "needs.changes.outputs.deps == 'true'";
const CI_SCRIPTS = "needs.changes.outputs.ci_scripts == 'true'";
const TEST_CONFIG = "needs.changes.outputs.test_config == 'true'";

/** One `needs.changes` flag term, wherever it appears in an expression. */
const FLAG_TERM = /needs\.changes\.outputs\.[a-z_]+ == 'true'/gu;

const BUILD_IF = `${FULL_SUITE} || ${PUBLIC_SURFACE}`;
const E2E_IF = `${FULL_SUITE} || ${DEPS}`;
const CONSUMER_IF = `${FULL_SUITE} || ${DEPS} || ${CI_SCRIPTS}`;
const MEMORY_IF = `${FULL_SUITE} || ${DEPS} || ${TEST_CONFIG} || ${CI_SCRIPTS}`;

/** Memory's old job env, now on each of its steps. */
const MEMORY_ENV = { MEMORY_WORKLOAD: 'test:memory', MEMORY_SAMPLES: '3', THRESHOLD_PCT: '10' };

/** Checkout keeps full history: memory's base checkout needs the merge base locally. */
const CHECKOUT_STEP = {
  uses: CHECKOUT,
  with: { 'fetch-depth': 0, 'persist-credentials': false },
};

/** Shared setup; Camoufox and its token only when the E2E factory tests run. */
const SETUP_STEP = {
  uses: SETUP_TEST_RUNNER,
  with: {
    camoufox: `\${{ (${E2E_IF}) && 'true' || 'false' }}`,
    'gh-token': `\${{ (${E2E_IF}) && secrets.GITHUB_TOKEN || '' }}`,
  },
};

/** The only background step, pinned whole. */
const E2E_STEP = {
  name: 'E2E factory tests',
  if: E2E_IF,
  background: true,
  'timeout-minutes': 15,
  run: 'npm run test:e2e-factory-tests -- --ci --verbose',
};

/** The foreground package chain, pinned whole and in order. */
const PACKAGE_CHAIN = [
  { uses: BUILD_PACKAGE, if: BUILD_IF, 'timeout-minutes': 10 },
  {
    name: 'Dry-run publish (catch packaging errors early)',
    if: BUILD_IF,
    'timeout-minutes': 10,
    run: 'npm pack --dry-run',
  },
  {
    name: 'Upload build artifact',
    if: BUILD_IF,
    'timeout-minutes': 10,
    uses: UPLOAD_ARTIFACT,
    with: { name: 'build-output', path: 'lib/', 'retention-days': 7 },
  },
  {
    uses: '$/.github/actions/setup-consumer-runtime',
    id: 'consumer-runtime',
    if: CONSUMER_IF,
    'timeout-minutes': 10,
  },
  {
    name: 'Package works for consumers',
    if: CONSUMER_IF,
    'timeout-minutes': 20,
    env: { CONSUMER_NODE: '${{ steps.consumer-runtime.outputs.node-path }}' },
    run: '/bin/bash .github/scripts/ci/consumer-install.sh',
  },
];

/** Where a failed E2E factory run fails the job, before memory starts. */
const WAIT_ALL_STEP = { name: 'Wait for the E2E factory tests', 'wait-all': null };

/** GNU time check: its command lines, comments and blanks dropped. */
const GNU_TIME_COMMANDS = [
  'set -euo pipefail',
  'if ! command -v /usr/bin/time > /dev/null 2>&1; then',
  'sudo apt-get update -qq',
  'sudo apt-get install -y -qq time',
  'fi',
  '/usr/bin/time --version',
];

/** The merge-base checkout; each failure path reports `ready=false`. */
const NOT_READY = ['echo "ready=false" >> "$GITHUB_OUTPUT"', 'exit 0', 'fi'];
const BASE_TREE_COMMANDS = [
  'set -euo pipefail',
  'if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then',
  'echo "::notice::Base commit ${BASE_SHA} is not available - skipping the comparison."',
  ...NOT_READY,
  'if ! git worktree add ../base "$BASE_SHA"; then',
  'echo "::notice::Could not materialise the base tree - skipping the comparison."',
  ...NOT_READY,
  'if git diff --quiet "$BASE_SHA" HEAD -- package.json package-lock.json; then',
  'if ! ln -s "$PWD/node_modules" ../base/node_modules; then',
  'echo "::notice::Could not share the resolved dependencies - skipping the comparison."',
  ...NOT_READY,
  'else',
  'echo "Dependencies changed - installing the base tree separately."',
  'if ! (cd ../base && npm ci --no-audit --no-fund); then',
  'echo "::notice::Could not install the base dependencies - skipping the comparison."',
  ...NOT_READY,
  'fi',
  'echo "ready=true" >> "$GITHUB_OUTPUT"',
];

/** The memory steps after `wait-all`, pinned whole; a script is its command lines. */
const MEMORY_STEPS = [
  { name: 'Ensure GNU time is available', env: MEMORY_ENV, run: GNU_TIME_COMMANDS },
  {
    name: 'Measure this PR',
    id: 'head',
    env: MEMORY_ENV,
    run: ['echo "mb=$(bash .github/scripts/ci/memory-measure.sh .)" >> "$GITHUB_OUTPUT"'],
  },
  {
    name: 'Check out the merge base',
    id: 'base_tree',
    env: { ...MEMORY_ENV, BASE_SHA: '${{ github.event.pull_request.base.sha }}' },
    run: BASE_TREE_COMMANDS,
  },
  {
    name: 'Measure the merge base',
    id: 'base',
    if: `(${MEMORY_IF}) && steps.base_tree.outputs.ready == 'true'`,
    env: MEMORY_ENV,
    run: ['echo "mb=$(bash .github/scripts/ci/memory-measure.sh ../base)" >> "$GITHUB_OUTPUT"'],
  },
  {
    name: 'Compare against the merge base',
    env: {
      ...MEMORY_ENV,
      BASE_MB: '${{ steps.base.outputs.mb }}',
      HEAD_MB: '${{ steps.head.outputs.mb }}',
    },
    run: ['bash .github/scripts/ci/memory-compare.sh'],
  },
].map(step => ({ if: MEMORY_IF, 'timeout-minutes': 30, ...step }));

/** The job's fields other than its steps and condition. */
const JOB_SHELL = {
  name: 'Package & E2E factory',
  needs: 'changes',
  'runs-on': 'ubuntu-latest',
  'timeout-minutes': 10 + 20 + 30,
  permissions: { contents: 'read' },
};

interface IStep {
  readonly name?: string;
  readonly if?: unknown;
  readonly uses?: string;
  readonly run?: string;
  readonly background?: unknown;
  readonly with?: Readonly<Record<string, unknown>>;
}

interface IJob {
  readonly if?: unknown;
  readonly needs?: unknown;
  readonly steps?: readonly IStep[];
}

interface IWorkflow {
  readonly jobs: Readonly<Record<string, IJob>>;
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
 * The job, or an empty job when it is missing.
 *
 * @returns The job.
 */
function job(): IJob {
  return jobs()[JOB_KEY] ?? {};
}

/**
 * The job's steps.
 *
 * @returns Steps in order, or none when the job is missing.
 */
function steps(): readonly IStep[] {
  return job().steps ?? [];
}

/**
 * Index of the job's `wait-all` step.
 *
 * @param all - The job's steps.
 * @returns The index, or -1 when there is none.
 */
function waitAllAt(all: readonly IStep[]): number {
  return all.findIndex(step => 'wait-all' in step);
}

/**
 * A step with its script reduced to command lines, so re-indenting or
 * re-wording a comment changes nothing while any command edit does.
 *
 * @param step - The step.
 * @returns The step, its `run` as trimmed non-blank non-comment lines.
 */
function withCommandLines(step: IStep): Readonly<Record<string, unknown>> {
  if (step.run === undefined) return { ...step };
  const lines = step.run.split('\n').map(line => line.trim());
  const commands = lines.filter(line => line !== '' && !line.startsWith('#'));
  return { ...step, run: commands };
}

/**
 * The distinct `needs.changes` flags a text mentions.
 *
 * @param text - A condition or input expression.
 * @returns The flag terms, sorted.
 */
function flagsIn(text: string): readonly string[] {
  const found = text.match(FLAG_TERM) ?? [];
  return [...new Set(found)].sort();
}

describe('Package & E2E factory job', () => {
  it('[PFJ-1] keeps the old runner and permissions, and the longest chain as its limit', () => {
    const { if: condition, steps: all, ...shell } = job();
    expect(shell).toStrictEqual(JOB_SHELL);
    expect(all?.length).toBeGreaterThan(0);
    expect(typeof condition).toBe('string');
  });

  it('[PFJ-2] starts on exactly the flags its steps gate on, OR-ed', () => {
    const condition = job().if;
    const text = typeof condition === 'string' ? condition : '';
    const terms = text.split(' || ');
    const all = steps();
    const stepText = JSON.stringify(all);
    const stepFlags = flagsIn(stepText);
    const sortedTerms = [...terms].sort();
    expect(sortedTerms).toStrictEqual(stepFlags);
  });

  it('[PFJ-3] checks out full history and sets up Camoufox only for the E2E factory tests', () => {
    const [checkout, setup] = steps();
    expect(checkout).toStrictEqual(CHECKOUT_STEP);
    expect(setup).toStrictEqual(SETUP_STEP);
  });

  it('[PFJ-4] runs the E2E factory tests as its only background step', () => {
    const all = steps();
    const background = all.filter(step => step.background !== undefined);
    const waits = all.filter(step => 'wait-all' in step || 'wait' in step);
    expect(background).toStrictEqual([E2E_STEP]);
    expect(waits).toStrictEqual([WAIT_ALL_STEP]);
  });

  it('[PFJ-5] runs build, pack, upload and consumer install in order before wait-all', () => {
    const all = steps();
    const waitAt = waitAllAt(all);
    const before = all.slice(2, waitAt);
    const foreground = before.filter(step => step.background === undefined);
    const e2eAt = all.findIndex(step => step.name === E2E_STEP.name);
    expect(foreground).toStrictEqual(PACKAGE_CHAIN);
    expect(e2eAt).toBe(2);
  });

  it('[PFJ-6] runs the memory steps alone, after wait-all, with their gate unchanged', () => {
    const all = steps();
    const waitAt = waitAllAt(all);
    const after = all.slice(waitAt + 1);
    const pinned = after.map(withCommandLines);
    expect(waitAt).toBeGreaterThan(0);
    expect(pinned).toStrictEqual(MEMORY_STEPS);
  });

  it('[PFJ-7] Validate blocks on both merged jobs and on none of the folded ones', () => {
    const byKey = jobs();
    const validate = byKey[VALIDATE_JOB_KEY] ?? {};
    const needs: readonly unknown[] = Array.isArray(validate.needs) ? validate.needs : [];
    const keys = Object.keys(byKey);
    const revived = FOLDED_JOB_KEYS.filter(key => keys.includes(key) || needs.includes(key));
    expect(needs).toContain(JOB_KEY);
    expect(needs).toContain(STATIC_CHECKS_JOB_KEY);
    expect(revived).toStrictEqual([]);
  });
});
