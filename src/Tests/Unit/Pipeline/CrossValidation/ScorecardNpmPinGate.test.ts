/**
 * Scorecard npm-pin gate.
 *
 * <p>OpenSSF Scorecard's `PinnedDependenciesID` classifies every `npm install`,
 * `npm i`, `npm install-test` and `npm update` as an unpinned download; only
 * `npm ci` and a git URL pinned to a full commit count as pinned. The scheduled
 * scan (`scorecard.yml`) raises those alerts only after a change has merged, so
 * the pull-request workflow runs the same engine, pinned by version and
 * checksum, over the merge tree: `.github/scripts/ci/scorecard-npm-pins.sh`,
 * with `check-scorecard-npm-pins.mjs` deciding the verdict.
 *
 * <p>Mirroring the engine rather than re-implementing its shell parser is the
 * point: the gate sees exactly what the scan sees. What this test pins is that
 * the gate stays a gate — that it can block a merge, cannot swallow its own
 * failure, verifies what it downloads before unpacking it, and moves its engine
 * with the scheduled scan's. It also keeps the release job's npm on a Node line
 * that bundles Trusted Publishing npm, so that job never has to download one.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const RELEASE_YAML = join(REPO_ROOT, '.github/workflows/release.yml');
const GATE_SCRIPT_PATH = '.github/scripts/ci/scorecard-npm-pins.sh';
const GATE_SCRIPT = join(REPO_ROOT, GATE_SCRIPT_PATH);
const ACTION_WORKFLOW_PATH = '.github/workflows/scorecard.yml';
const ACTION_WORKFLOW = join(REPO_ROOT, ACTION_WORKFLOW_PATH);

/** YAML key of the gate job, and of the aggregator that decides what can block a merge. */
const GATE_JOB_KEY = 'scorecard-npm-pins';
const VALIDATE_JOB_KEY = 'validate';

/** How the gate job invokes its script. */
const GATE_COMMAND = '/bin/bash .github/scripts/ci/scorecard-npm-pins.sh';

/** Longest the gate job may run; Scorecard itself takes seconds. */
const MAX_GATE_MINUTES = 15;

/** A pinned action reference: owner/name at a full commit SHA. */
const PINNED_CHECKOUT = /^actions\/checkout@[0-9a-f]{40}$/;

/** Anything that would hand a credential to the downloaded binary. */
const CREDENTIAL = /secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN/;

/** Shell that would let a failing command pass. */
const SWALLOWED_FAILURE = /\|\|\s*(?:true|:)(?![\w-])|set \+e/;

/** The verdict: the script's last command, so its exit status is the gate's. */
const VERDICT_COMMAND = 'node "${CHECKER}" "${RESULT}" "v${SCORECARD_VERSION}"';

/** Lowest npm that can complete the Trusted Publishing OIDC exchange. */
const TRUSTED_PUBLISHING_NPM = '11.5.1';
/** First Node major whose bundled npm can reach that version. */
const MIN_PUBLISH_NODE_MAJOR = 24;

/** Engine the gate pins, as the scheduled scan's go.mod spells it. */
const PINNED_ENGINE = 'v5.5.0';

/** What the gate says when scorecard.yml does not run exactly one action commit. */
const PIN_REJECTED = 'expected one SHA-pinned ossf/scorecard-action';

/** scorecard-action references a scorecard.yml step can carry. */
const ACTION_STEP = '      - uses: ossf/scorecard-action@';
const ACTION_SHA = '2d1146689b8cda280b9bc96326124645441f03bc';
const OTHER_SHA = 'ae6de97fb1d0f3dcbe1b3e3e2b05bb0bd9f0f4c1';
const ACTION_TAG = 'v2.4.4';

/** Where the gate reads an action commit's go.mod, and the action it reads it for. */
const ACTION_GO_MOD_URL = 'https://raw.githubusercontent.com/ossf/scorecard-action';
const SCORECARD_ACTION = 'ossf/scorecard-action@';

/** A full commit SHA. */
const FULL_SHA = /^[0-9a-f]{40}$/;

interface IWorkflowStep {
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
  readonly env?: unknown;
  readonly 'timeout-minutes'?: number;
  readonly 'continue-on-error'?: unknown;
  readonly steps: readonly IWorkflowStep[];
}

interface IWorkflowDoc {
  readonly env?: unknown;
  readonly jobs: Readonly<Record<string, IWorkflowJob>>;
}

/** A scorecard.yml body, and whether the gate must take its action pin. */
interface IPinCase {
  readonly name: string;
  readonly lines: readonly string[];
  readonly accepted: boolean;
}

/** What one run of the gate script reported. */
interface IGateRun {
  readonly status: number;
  readonly output: string;
  readonly didExtract: boolean;
  /** The action go.mod URL the gate fetched, or empty when it fetched none. */
  readonly goModUrl: string;
}

/** A Trusted Publishing npm version, and whether the release guard must accept it. */
interface IGuardCase {
  readonly version: string;
  readonly accepted: boolean;
}

/**
 * Parse a workflow file.
 *
 * @param path - Workflow path.
 * @returns Parsed workflow.
 */
function loadWorkflow(path: string): IWorkflowDoc {
  const text = readFileSync(path, 'utf8');
  return parse(text) as IWorkflowDoc;
}

/**
 * The gate job of the pull-request workflow.
 *
 * @returns The job, or an empty job when it is missing.
 */
function gateJob(): IWorkflowJob {
  const doc = loadWorkflow(PR_YAML);
  return doc.jobs[GATE_JOB_KEY] ?? { steps: [] };
}

/**
 * The jobs the merge-blocking aggregator waits for.
 *
 * @returns Job keys in its `needs`.
 */
function validateNeeds(): readonly string[] {
  const doc = loadWorkflow(PR_YAML);
  const needs = doc.jobs[VALIDATE_JOB_KEY].needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * The gate script's source.
 *
 * @returns Script text, or empty when it is missing.
 */
function gateScript(): string {
  return existsSync(GATE_SCRIPT) ? readFileSync(GATE_SCRIPT, 'utf8') : '';
}

/**
 * The last command the gate script runs.
 *
 * @param script - Script source.
 * @returns Its last line that is neither blank nor a comment.
 */
function lastCommand(script: string): string {
  const lines = script.split('\n').map(line => line.trim());
  const commands = lines.filter(line => line !== '' && !line.startsWith('#'));
  return commands.at(-1) ?? '';
}

/**
 * Create a throwaway directory.
 *
 * @param name - Directory name prefix.
 * @returns The directory.
 */
function makeTempDir(name: string): string {
  const temp = tmpdir();
  const prefix = join(temp, name);
  return mkdtempSync(prefix);
}

/**
 * Write an executable into a directory.
 *
 * @param dir - Directory to write into.
 * @param name - Command name.
 * @param body - Shell script body.
 * @returns The command's path.
 */
function writeCommand(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * A `curl` that serves a go.mod embedding `$STUB_ENGINE` and records its URL,
 * and anything else as a file that is not the release asset; and a `tar` that
 * only records it ran. Nothing reaches the network.
 *
 * @returns Directory holding the stubs, to prepend to `PATH`.
 */
function makeDownloadStubs(): string {
  const dir = makeTempDir('snp-stubs-');
  const curl = [
    'out=""; url=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in --output) out="$2"; shift ;; https://*) url="$1" ;; esac',
    '  shift',
    'done',
    'case "$url" in',
    '  */go.mod)',
    '    printf "\\tgithub.com/ossf/scorecard/v5 %s\\n" "$STUB_ENGINE" > "$out"',
    '    printf "%s" "$url" > "$STUB_GO_MOD_LOG" ;;',
    '  *) printf "not the release asset\\n" > "$out" ;;',
    'esac',
  ];
  writeCommand(dir, 'curl', `${curl.join('\n')}\n`);
  writeCommand(dir, 'tar', 'touch "$STUB_TAR_MARKER"\n');
  return dir;
}

/**
 * Environment that puts the download stubs first on `PATH`.
 *
 * @param stubs - Directory holding the stubs.
 * @param settings - What the stubs serve and where they record.
 * @returns The environment.
 */
function stubEnvFor(stubs: string, settings: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const path = `${stubs}:${process.env.PATH ?? ''}`;
  return { ...process.env, PATH: path, TMPDIR: stubs, RUNNER_TEMP: stubs, ...settings };
}

/**
 * The `ossf/scorecard-action` refs a workflow's steps run, parsed as YAML.
 *
 * @param path - Workflow path.
 * @returns Refs after the `@`.
 */
function actionRefsIn(path: string): readonly string[] {
  const doc = loadWorkflow(path);
  const jobs: readonly Partial<IWorkflowJob>[] = Object.values(doc.jobs);
  const steps = jobs.flatMap(job => job.steps ?? []);
  const actionSteps = steps.filter(step => step.uses?.startsWith(SCORECARD_ACTION) ?? false);
  return actionSteps.map(step => step.uses?.slice(SCORECARD_ACTION.length) ?? '');
}

/**
 * Run the gate script against the download stubs.
 *
 * @param engine - Scorecard version the stub action go.mod embeds.
 * @param script - Gate script to run.
 * @returns Exit status, output, and whether anything was extracted.
 */
function runGate(engine: string, script = GATE_SCRIPT): IGateRun {
  const stubs = makeDownloadStubs();
  const marker = join(stubs, 'tar-ran');
  const goModLog = join(stubs, 'go-mod-url');
  const env = stubEnvFor(stubs, {
    STUB_ENGINE: engine,
    STUB_TAR_MARKER: marker,
    STUB_GO_MOD_LOG: goModLog,
  });
  try {
    const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
    const output = `${result.stdout}${result.stderr}`;
    const goModUrl = existsSync(goModLog) ? readFileSync(goModLog, 'utf8') : '';
    return { status: result.status ?? -1, output, didExtract: existsSync(marker), goModUrl };
  } finally {
    rmSync(stubs, { recursive: true, force: true });
  }
}

/**
 * Write a file, creating its directory.
 *
 * @param path - File to write.
 * @param text - Its content.
 * @returns The path.
 */
function writeFileWithDir(path: string, text: string): string {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * Run a copy of the gate script in a scratch repo whose scorecard.yml holds
 * `lines`, with the stub go.mod embedding the pinned engine.
 *
 * @param lines - scorecard.yml step lines.
 * @returns What the gate reported.
 */
function runGateWithWorkflow(lines: readonly string[]): IGateRun {
  const root = makeTempDir('snp-repo-');
  const script = join(root, GATE_SCRIPT_PATH);
  const workflowPath = join(root, ACTION_WORKFLOW_PATH);
  const workflow = ['jobs:', '  analysis:', '    steps:', ...lines, ''].join('\n');
  writeFileWithDir(workflowPath, workflow);
  const source = gateScript();
  writeFileWithDir(script, source);
  try {
    return runGate(PINNED_ENGINE, script);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Read the steps of the release workflow's publish job.
 *
 * @returns Steps in execution order.
 */
function publishSteps(): readonly IWorkflowStep[] {
  const doc = loadWorkflow(RELEASE_YAML);
  return doc.jobs.publish.steps;
}

/**
 * Index of the first publish-job step whose `run` script contains `needle`.
 *
 * @param needle - Text the step's script must contain.
 * @returns Step index, or -1 when no step matches.
 */
function stepIndexRunning(needle: string): number {
  return publishSteps().findIndex(step => step.run?.includes(needle) ?? false);
}

/**
 * Whether a workflow step is `actions/setup-node`.
 *
 * @param step - Workflow step.
 * @returns True for a setup-node step.
 */
function isSetupNode(step: IWorkflowStep): boolean {
  return step.uses?.startsWith('actions/setup-node@') ?? false;
}

/**
 * Create a directory holding a fake `npm` that prints `$STUB_NPM_VERSION`.
 *
 * @returns The directory, to prepend to `PATH`.
 */
function makeNpmStub(): string {
  const dir = makeTempDir('snp-npm-');
  writeCommand(dir, 'npm', 'echo "$STUB_NPM_VERSION"\n');
  return dir;
}

/**
 * Run the publish job's npm guard while `npm --version` reports `version`.
 *
 * @param version - Version the stub npm reports.
 * @param stubDir - Directory holding the stub npm.
 * @returns The guard's exit status.
 */
function guardExitFor(version: string, stubDir: string): number {
  const guard = publishSteps().find(step => step.run?.includes(TRUSTED_PUBLISHING_NPM) ?? false);
  const script = guard?.run ?? 'exit 99';
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
    STUB_NPM_VERSION: version,
  };
  const result = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  return result.status ?? -1;
}

const GUARD_CASES: readonly IGuardCase[] = [
  { version: '10.9.9', accepted: false },
  { version: '11.4.2', accepted: false },
  { version: '11.5.0', accepted: false },
  { version: '11.5.1', accepted: true },
  { version: '11.19.0', accepted: true },
  { version: '12.0.0', accepted: true },
];

const PIN_CASES: readonly IPinCase[] = [
  { name: 'one active SHA pin', lines: [`${ACTION_STEP}${ACTION_SHA} # v2.4.4`], accepted: true },
  {
    name: 'a SHA pin beside a commented-out one',
    lines: [`      # - uses: ossf/scorecard-action@${OTHER_SHA}`, `${ACTION_STEP}${ACTION_SHA}`],
    accepted: true,
  },
  {
    name: 'a mutable tag behind a commented-out SHA',
    lines: [`      # - uses: ossf/scorecard-action@${ACTION_SHA}`, `${ACTION_STEP}${ACTION_TAG}`],
    accepted: false,
  },
  {
    name: 'a SHA pin beside a mutable tag',
    lines: [`${ACTION_STEP}${ACTION_SHA}`, `${ACTION_STEP}${ACTION_TAG}`],
    accepted: false,
  },
  { name: 'only a mutable tag', lines: [`${ACTION_STEP}${ACTION_TAG}`], accepted: false },
  {
    name: 'a SHA pin beside a quoted mutable tag',
    lines: [`${ACTION_STEP}${ACTION_SHA}`, `      - uses: "ossf/scorecard-action@${ACTION_TAG}"`],
    accepted: false,
  },
  {
    name: 'a SHA pin beside a flow-map mutable tag',
    lines: [`${ACTION_STEP}${ACTION_SHA}`, `      - { uses: ossf/scorecard-action@${ACTION_TAG} }`],
    accepted: false,
  },
  {
    name: 'a SHA with a suffix YAML keeps in the ref',
    lines: [`${ACTION_STEP}${ACTION_SHA}#${ACTION_TAG}`],
    accepted: false,
  },
];

describe('Scorecard npm-pin gate', () => {
  it('[SNP-1] runs on every pull request and can block the merge', () => {
    const job = gateJob();
    expect(job.steps.length).toBeGreaterThan(0);
    const needs = validateNeeds();
    expect(job.if).toBeUndefined();
    expect(needs).toContain(GATE_JOB_KEY);
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(MAX_GATE_MINUTES);
  });

  it('[SNP-2] cannot pass by ignoring its own failure', () => {
    const job = gateJob();
    const lenientSteps = job.steps.filter(step => step['continue-on-error'] !== undefined);
    expect(job['continue-on-error']).toBeUndefined();
    expect(lenientSteps).toEqual([]);
    const commands = job.steps.map(step => step.run);
    const script = gateScript();
    const verdict = lastCommand(script);
    expect(commands).toContain(GATE_COMMAND);
    expect(script).toContain('set -euo pipefail');
    expect(script).not.toMatch(SWALLOWED_FAILURE);
    expect(verdict).toBe(VERDICT_COMMAND);
  });

  it('[SNP-3] scans the merge commit with no credential in reach of the binary', () => {
    const workflow = loadWorkflow(PR_YAML);
    const job = workflow.jobs[GATE_JOB_KEY];
    const [checkout] = job.steps;
    const inReach = JSON.stringify({ env: workflow.env, job });
    expect(checkout.uses).toMatch(PINNED_CHECKOUT);
    expect(checkout.with?.['persist-credentials']).toBe(false);
    expect(checkout.with?.ref).toBeUndefined();
    expect(inReach).not.toMatch(CREDENTIAL);
  });

  /**
   * npm only ships 11.5.1+ with Node 24.5+, and no Node 22 release bundles it,
   * so the publish job takes its npm from Node 24 instead of downloading one.
   * `check-latest` stops setup-node from settling for an older 24.x already in
   * the runner's tool cache.
   */
  it('[SNP-4] the publish job runs on a Node line that bundles Trusted Publishing npm', () => {
    const setupNode = publishSteps().find(isSetupNode);
    expect(setupNode?.with?.['node-version-file']).toBeUndefined();
    expect(setupNode?.with?.['check-latest']).toBe(true);
    const nodeVersion = String(setupNode?.with?.['node-version']);
    const major = Number.parseInt(nodeVersion, 10);
    expect(major).toBeGreaterThanOrEqual(MIN_PUBLISH_NODE_MAJOR);
  });

  it('[SNP-5] the publish job checks npm after setup-node, before install and publish', () => {
    const steps = publishSteps();
    const setupNodes = steps.filter(isSetupNode);
    const setupNode = steps.findIndex(isSetupNode);
    const guard = stepIndexRunning(TRUSTED_PUBLISHING_NPM);
    const install = stepIndexRunning('npm ci');
    const publish = stepIndexRunning('npm publish');
    expect(setupNodes).toHaveLength(1);
    expect(guard).toBeGreaterThan(setupNode);
    expect(install).toBeGreaterThan(guard);
    expect(publish).toBeGreaterThan(guard);
  });

  describe('[SNP-6] the npm guard, executed', () => {
    let stubDir = '';
    beforeAll(() => {
      stubDir = makeNpmStub();
    });
    afterAll(() => {
      rmSync(stubDir, { recursive: true, force: true });
    });

    it.each(GUARD_CASES)('npm $version is accepted: $accepted', row => {
      const status = guardExitFor(row.version, stubDir);
      expect(status === 0).toBe(row.accepted);
    });
  });

  it('[SNP-7] refuses a release asset whose checksum differs, before unpacking it', () => {
    const run = runGate(PINNED_ENGINE);
    expect(run.output).toContain('checksum');
    expect(run.didExtract).toBe(false);
    expect(run.status).not.toBe(0);
  });

  it('[SNP-8] refuses to run when the scheduled scan embeds a different engine', () => {
    const run = runGate('v5.6.0');
    expect(run.output).toContain(`does not embed Scorecard ${PINNED_ENGINE}`);
    expect(run.didExtract).toBe(false);
    expect(run.status).not.toBe(0);
  });

  it('[SNP-9] proves the scan can fail, then checks the tree the scheduled scan reads', () => {
    const script = gateScript();
    const canary = script.indexOf('scan "${CANARY}" "${CANARY_RESULT}"');
    const tree = script.indexOf('scan "${TREE}" "${RESULT}"');
    expect(canary).toBeGreaterThan(-1);
    expect(tree).toBeGreaterThan(canary);
    expect(script).toContain('git archive --format=tar HEAD');
    expect(script).toContain('find "${TREE}" \\( -type l -o -type f -empty \\) -delete');
  });

  it.each(PIN_CASES)('[SNP-10] takes the engine pin only from an active SHA: $name', row => {
    const run = runGateWithWorkflow(row.lines);
    const isPinRejected = run.output.includes(PIN_REJECTED);
    const didReachDownload = run.output.includes('checksum');
    const fetched = row.accepted ? `${ACTION_GO_MOD_URL}/${ACTION_SHA}/go.mod` : '';
    expect(isPinRejected).toBe(!row.accepted);
    expect(didReachDownload).toBe(row.accepted);
    expect(run.goModUrl).toBe(fetched);
    expect(run.status).not.toBe(0);
  });

  it('[SNP-11] checks the engine of the action step the scheduled scan actually runs', () => {
    const refs = actionRefsIn(ACTION_WORKFLOW);
    const run = runGate(PINNED_ENGINE);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatch(FULL_SHA);
    expect(run.goModUrl).toBe(`${ACTION_GO_MOD_URL}/${refs[0]}/go.mod`);
  });

  it('[SNP-12] reads action steps past jobs that call a reusable workflow', () => {
    const dir = makeTempDir('snp-workflow-');
    const lines = ['jobs:', '  called:', '    uses: ./.github/workflows/other.yml', '  analysis:'];
    const workflow = [...lines, '    steps:', `${ACTION_STEP}${ACTION_SHA}`, ''].join('\n');
    const target = join(dir, 'scorecard.yml');
    const path = writeFileWithDir(target, workflow);
    try {
      const refs = actionRefsIn(path);
      expect(refs).toEqual([ACTION_SHA]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
