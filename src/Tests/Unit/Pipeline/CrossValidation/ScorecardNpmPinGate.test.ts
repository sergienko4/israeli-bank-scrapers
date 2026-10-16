/**
 * Scorecard npm-pin gate.
 *
 * <p>OpenSSF Scorecard's `PinnedDependenciesID` classifies every `npm install`,
 * `npm i`, `npm install-test` and `npm update` as an unpinned download; only
 * `npm ci` and a git URL pinned to a full commit count as pinned. The scheduled
 * scan (`scorecard.yml`) raises those alerts only after a change has merged, so
 * the pull-request workflow runs the same engine — the one the scan's action
 * commit requires, verified by its SLSA provenance — over the merge tree:
 * `.github/scripts/ci/scorecard-npm-pins.sh`, run as a background step of the
 * `Static checks` job, with `check-scorecard-npm-pins.mjs` deciding the verdict.
 *
 * <p>Mirroring the engine rather than re-implementing its shell parser is the
 * point: the gate sees exactly what the scan sees. What this test pins is that
 * the gate stays a gate — that it can block a merge, cannot swallow its own
 * failure, verifies what it downloads before unpacking it, and takes its engine
 * from the scheduled scan's, naming no version itself. It also keeps the
 * release job's npm on a Node line that bundles Trusted Publishing npm, so that
 * job never has to download one.
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

/**
 * YAML key of the job that runs the gate as one of its steps, and of the
 * aggregator that decides what can block a merge.
 */
const GATE_JOB_KEY = 'static-checks';
const VALIDATE_JOB_KEY = 'validate';

/** The gate step's name in that job. */
const GATE_STEP_NAME = 'npm commands are pinned as Scorecard reads them';

/**
 * The job's last step, pinned whole. The gate runs in the background, and a
 * failed background step fails the job only at a `wait-all` that includes it,
 * so a `continue-on-error` here would let the gate fail unseen.
 */
const WAIT_ALL_STEP = { name: 'Wait for the background gates', 'wait-all': null };

/** How the gate step invokes its script. */
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
const VERDICT_COMMAND = 'node "${CHECKER}" "${RESULT}" "${SCORECARD_VERSION}"';

/** Lowest npm that can complete the Trusted Publishing OIDC exchange. */
const TRUSTED_PUBLISHING_NPM = '11.5.1';
/** First Node major whose bundled npm can reach that version. */
const MIN_PUBLISH_NODE_MAJOR = 24;

/**
 * Engines a stub action go.mod can require. The gate names none itself, so
 * any release version must work.
 */
const ENGINE = 'v5.6.0';
const OTHER_ENGINE = 'v5.7.1';

/** The commit the stub Go module proxy says a release was cut from. */
const SOURCE_DIGEST = '61e84743356275f6ffca23b1b2f2cb945e19eb96';
const ENGINE_REPO_URL = 'https://github.com/ossf/scorecard';
const MODULE_PROXY_URL = 'https://proxy.golang.org/github.com/ossf/scorecard/v5/@v';
const RELEASES_URL = `${ENGINE_REPO_URL}/releases/download`;

/** Stands in for the scratch path of the provenance bundle in recorded `gh` args. */
const BUNDLE_ARG = '<bundle>';

/** What `gh attestation verify` must be told about the asset, after its path. */
const PROVENANCE_POLICY = [
  ['--bundle', BUNDLE_ARG],
  ['--repo', 'ossf/scorecard'],
  ['--predicate-type', 'https://slsa.dev/provenance/v0.2'],
  ['--source-ref', `refs/tags/${ENGINE}`],
  ['--source-digest', SOURCE_DIGEST],
  [
    '--signer-workflow',
    'slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml',
  ],
  ['--cert-oidc-issuer', 'https://token.actions.githubusercontent.com'],
  ['--deny-self-hosted-runners'],
].flat();

/** The asset `gh` verifies, for any platform the gate supports. */
const ASSET_PATH = /\/scorecard_5\.6\.0_(?:linux|darwin)_(?:amd64|arm64)\.tar\.gz$/;

/** What the gate says when the stub `gh` rejects the asset. */
const PROVENANCE_REJECTED = 'failed provenance verification';

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
  readonly name?: string;
  readonly if?: unknown;
  readonly background?: unknown;
  readonly 'timeout-minutes'?: number;
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
  /** Every URL the gate fetched, in order. */
  readonly urls: readonly string[];
  /** Arguments of the gate's `gh attestation verify`, or empty when it ran none. */
  readonly verifyArgs: readonly string[];
}

/** What the stub downloads serve and how the stub `gh` answers. */
type StubSettings = Readonly<Record<string, string>>;

/** An action go.mod or proxy reply the gate must refuse, and what it says. */
interface IEngineCase {
  readonly name: string;
  readonly stub: StubSettings;
  readonly message: string;
}

/** A `gh --version` answer, and whether the gate may verify with that gh. */
interface IGhCase {
  readonly version: string;
  readonly accepted: boolean;
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
 * The gate step of the job that runs it.
 *
 * @returns The step, or an empty step when it is missing.
 */
function gateStep(): IWorkflowStep {
  const steps = gateJob().steps;
  return steps.find(step => step.name === GATE_STEP_NAME) ?? {};
}

/**
 * The jobs a job waits for.
 *
 * @param job - The job.
 * @returns Job keys in its `needs`.
 */
function needsOf(job: IWorkflowJob): readonly string[] {
  const needs = job.needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * The jobs the merge-blocking aggregator waits for.
 *
 * @returns Job keys in its `needs`.
 */
function validateNeeds(): readonly string[] {
  const doc = loadWorkflow(PR_YAML);
  return needsOf(doc.jobs[VALIDATE_JOB_KEY]);
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
 * A `curl` that records each URL and serves `$STUB_GO_MOD` for a go.mod,
 * `$STUB_INFO` for a module-proxy reply, and anything else as a file that is
 * not the release asset; a `gh` that answers `--version` with
 * `$STUB_GH_VERSION` and `--help` with `$STUB_GH_HELP`, and records a verify
 * call's arguments before exiting `$STUB_GH_STATUS`; and a
 * `tar` that only records it ran. Nothing reaches the network.
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
    'printf "%s\\n" "$url" >> "$STUB_URL_LOG"',
    'case "$url" in',
    '  */go.mod) printf "%b" "$STUB_GO_MOD" > "$out" ;;',
    '  *.info) printf "%s" "$STUB_INFO" > "$out" ;;',
    '  *) printf "not the release asset\\n" > "$out" ;;',
    'esac',
  ];
  const gh = [
    'if [ "$1" = "--version" ]; then printf "%s\\n" "$STUB_GH_VERSION"; exit 0; fi',
    'if [ "$3" = "--help" ]; then printf "%s\\n" "$STUB_GH_HELP"; exit 0; fi',
    'printf "%s\\n" "$@" > "$STUB_GH_LOG"',
    'exit "$STUB_GH_STATUS"',
  ];
  writeCommand(dir, 'curl', `${curl.join('\n')}\n`);
  writeCommand(dir, 'gh', `${gh.join('\n')}\n`);
  writeCommand(dir, 'tar', 'touch "$STUB_TAR_MARKER"\n');
  return dir;
}

/**
 * The Go module proxy's reply for a release cut from {@link SOURCE_DIGEST}.
 *
 * @param engine - Release version.
 * @param origin - Origin fields to override.
 * @returns The reply's JSON text.
 */
function proxyInfo(engine: string, origin: StubSettings = {}): string {
  const tagged = { VCS: 'git', URL: ENGINE_REPO_URL, Hash: SOURCE_DIGEST };
  const fields = { ...tagged, Ref: `refs/tags/${engine}`, ...origin };
  return JSON.stringify({ Version: engine, Origin: fields });
}

/**
 * Stub answers for a tagged release whose provenance does not verify, so a
 * run stops before it unpacks anything.
 *
 * @param engine - Release version the stub action go.mod requires.
 * @returns The settings.
 */
function stubSettings(engine: string): StubSettings {
  const goMod = `require (\\n\\tgithub.com/ossf/scorecard/v5 ${engine}\\n)\\n`;
  const info = proxyInfo(engine);
  return {
    STUB_GO_MOD: goMod,
    STUB_INFO: info,
    STUB_GH_VERSION: 'gh version 2.102.0 (2026-09-30)',
    STUB_GH_HELP: '--source-digest',
    STUB_GH_STATUS: '1',
  };
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
 * The lines a stub recorded.
 *
 * @param path - Log file.
 * @returns Its lines, or none when the stub never wrote it.
 */
function readLog(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text.split('\n').filter(line => line !== '');
}

/**
 * Run the gate script against the download stubs.
 *
 * @param engine - Scorecard version the stub action go.mod requires.
 * @param overrides - Stub answers that replace the defaults.
 * @param script - Gate script to run.
 * @returns Exit status, output, what was fetched and verified, and whether
 *   anything was extracted.
 */
function runGate(engine: string, overrides: StubSettings = {}, script = GATE_SCRIPT): IGateRun {
  const stubs = makeDownloadStubs();
  const [marker, urlLog, ghLog] = ['tar-ran', 'urls', 'gh-args'].map(name => join(stubs, name));
  const logs = { STUB_TAR_MARKER: marker, STUB_URL_LOG: urlLog, STUB_GH_LOG: ghLog };
  const env = stubEnvFor(stubs, { ...stubSettings(engine), ...overrides, ...logs });
  try {
    const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
    const output = `${result.stdout}${result.stderr}`;
    const urls = readLog(urlLog);
    const goModUrl = urls.find(url => url.endsWith('/go.mod')) ?? '';
    const [status, didExtract, verifyArgs] = [
      result.status ?? -1,
      existsSync(marker),
      readLog(ghLog),
    ];
    return { status, output, didExtract, goModUrl, urls, verifyArgs };
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
 * `lines`, with the stub go.mod requiring {@link ENGINE}.
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
    return runGate(ENGINE, {}, script);
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

const UNTIED = 'does not require exactly one';
const UNTAGGED = 'names no tagged ossf/scorecard commit';
const REQUIRED = `require (\\n\\tgithub.com/ossf/scorecard/v5 ${ENGINE}\\n)\\n`;
const FORK = `github.com/ossf/scorecard/v5 ${ENGINE} => github.com/fork/scorecard/v5 ${ENGINE}`;
/** The engine module as a Go quoted string, which go.mod reads as the bare path. */
const QUOTED_MODULE = '"github.com/ossf/scorecard/v5"';
/** The same path with its last slash escaped (`\x2f`), which Go unquotes to the engine. */
const ESCAPED_MODULE = '"github.com/ossf/scorecard\\\\x2fv5"';
const FORKED = `=> github.com/fork/scorecard/v5 ${OTHER_ENGINE}`;
/**
 * A case whose action go.mod the gate cannot tie to one tagged release.
 *
 * @param name - What the go.mod does.
 * @param goMod - The go.mod text, escaped for `printf "%b"`.
 * @returns The case.
 */
function untied(name: string, goMod: string): IEngineCase {
  return { name, stub: { STUB_GO_MOD: goMod }, message: UNTIED };
}
const ENGINE_CASES: readonly IEngineCase[] = [
  untied('no engine module', 'require (\\n\\tgithub.com/other/mod v1.0.0\\n)\\n'),
  untied('a mention only in a comment', `// github.com/ossf/scorecard/v5 ${ENGINE}\\n`),
  untied('a replaced engine', `${REQUIRED}replace ${FORK}\\n`),
  untied('a replace block and no require', `replace (\\n\\t${FORK}\\n)\\n`),
  untied(
    'an exclude beside the require',
    `${REQUIRED}exclude github.com/ossf/scorecard/v5 v5.5.0\\n`,
  ),
  untied('a quoted replace', `${REQUIRED}replace ${QUOTED_MODULE} ${FORKED}\\n`),
  untied(
    'a quoted replace in a block',
    `${REQUIRED}replace (\\n\\t${QUOTED_MODULE} ${FORKED}\\n)\\n`,
  ),
  untied('a quoted exclude', `${REQUIRED}exclude ${QUOTED_MODULE} v5.5.0\\n`),
  untied(
    'a quoted replace with an escaped slash',
    `${REQUIRED}replace ${ESCAPED_MODULE} ${FORKED}\\n`,
  ),
  untied('a replace block opened with no space', `${REQUIRED}replace(\\n\\t${FORK}\\n)\\n`),
  untied(
    'an exclude block opened with no space',
    `${REQUIRED}exclude(\\n\\tgithub.com/ossf/scorecard/v5 v5.5.0\\n)\\n`,
  ),
  untied('a replace split by a carriage return', `${REQUIRED}replace\\r${FORK}\\n`),
  untied('a replace after an empty one-line block', `${REQUIRED}exclude ( )\\nreplace ${FORK}\\n`),
  untied('a block opened by a quoted word', `${REQUIRED}"junk" (\\n)\\n`),
  untied(
    'a pseudo-version',
    'require (\\n\\tgithub.com/ossf/scorecard/v5 v5.6.1-0.20261001000000-61e847433562\\n)\\n',
  ),
  {
    name: 'an origin on a branch',
    stub: { STUB_INFO: proxyInfo(ENGINE, { Ref: 'refs/heads/main' }) },
    message: UNTAGGED,
  },
  {
    name: 'an origin in a fork',
    stub: { STUB_INFO: proxyInfo(ENGINE, { URL: 'https://github.com/fork/scorecard' }) },
    message: UNTAGGED,
  },
  {
    name: 'an origin hash that is no commit',
    stub: { STUB_INFO: proxyInfo(ENGINE, { Hash: 'abc' }) },
    message: UNTAGGED,
  },
  {
    name: 'a reply for another version',
    stub: { STUB_INFO: proxyInfo(OTHER_ENGINE) },
    message: UNTAGGED,
  },
  { name: 'a reply that is not JSON', stub: { STUB_INFO: 'not json' }, message: UNTAGGED },
];

/** Text the gate prints when its `gh` is too old to enforce the policy exactly. */
const GH_NEEDED = 'GitHub CLI 2.102.0 or newer';
const GH_CASES: readonly IGhCase[] = [
  { version: 'gh version 2.102.0 (2026-09-30)', accepted: true },
  { version: 'gh version 10.0.0', accepted: true },
  { version: 'gh version 2.101.0 (2026-09-15)', accepted: false },
  { version: 'gh version 2.99.9', accepted: false },
  { version: 'gh version 2.102.0-rc.1', accepted: false },
  { version: 'gh version DEV', accepted: false },
];

describe('Scorecard npm-pin gate', () => {
  /**
   * The job also waits for `changes`; `Validate` needs every job it needs, so a
   * failed `changes` fails `Validate` rather than silently skipping the gate.
   */
  it('[SNP-1] runs on every pull request and can block the merge', () => {
    const job = gateJob();
    const step = gateStep();
    const needs = validateNeeds();
    const unwaited = needsOf(job).filter(key => !needs.includes(key));
    expect(job.if).toBeUndefined();
    expect(step.if).toBeUndefined();
    expect(needs).toContain(GATE_JOB_KEY);
    expect(unwaited).toEqual([]);
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(MAX_GATE_MINUTES);
    expect(step['timeout-minutes']).toBeLessThanOrEqual(MAX_GATE_MINUTES);
  });

  it('[SNP-1] runs in the background, and the job fails at the closing wait-all', () => {
    const steps = gateJob().steps;
    const step = gateStep();
    const index = steps.findIndex(candidate => candidate.name === GATE_STEP_NAME);
    const last = steps.at(-1);
    expect(step.background).toBe(true);
    expect(index).toBeGreaterThan(0);
    expect(last).toStrictEqual(WAIT_ALL_STEP);
  });

  /**
   * Other steps of the job may tolerate their own failure; only the gate step,
   * the wait-all that surfaces it, and the job itself must not.
   */
  it('[SNP-2] cannot pass by ignoring its own failure', () => {
    const job = gateJob();
    const step = gateStep();
    expect(job['continue-on-error']).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
    const commands = [step.run];
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

  it('[SNP-7] refuses a release asset whose provenance does not verify, before unpacking it', () => {
    const run = runGate(ENGINE);
    expect(run.output).toContain(PROVENANCE_REJECTED);
    expect(run.didExtract).toBe(false);
    expect(run.status).not.toBe(0);
  });

  it('[SNP-7] unpacks the asset only once its provenance verifies', () => {
    const run = runGate(ENGINE, { STUB_GH_STATUS: '0' });
    expect(run.output).not.toContain(PROVENANCE_REJECTED);
    expect(run.didExtract).toBe(true);
  });

  it('[SNP-7] verifies the asset as built by the SLSA generator from the tagged commit', () => {
    const run = runGate(ENGINE);
    const [subcommand, verb, asset, ...flags] = run.verifyArgs;
    const policy = flags.map(arg => (arg.endsWith('.intoto.jsonl') ? BUNDLE_ARG : arg));
    expect([subcommand, verb]).toEqual(['attestation', 'verify']);
    expect(asset).toMatch(ASSET_PATH);
    expect(policy).toEqual(PROVENANCE_POLICY);
  });

  it.each([ENGINE, OTHER_ENGINE])(
    '[SNP-8] runs the engine the scheduled scan requires: %s',
    engine => {
      const run = runGate(engine);
      const release = `${RELEASES_URL}/${engine}`;
      const assets = run.urls.filter(url => url.startsWith(`${release}/`));
      expect(run.urls).toContain(`${MODULE_PROXY_URL}/${engine}.info`);
      expect(run.urls).toContain(`${release}/multiple.intoto.jsonl`);
      expect(assets).toHaveLength(2);
      expect(run.verifyArgs).toContain(`refs/tags/${engine}`);
    },
  );

  it('[SNP-8] reads a one-line require, past comments that name another release', () => {
    const goMod = `// was github.com/ossf/scorecard/v5 v5.5.0\\nrequire github.com/ossf/scorecard/v5 ${ENGINE} // indirect\\n`;
    const run = runGate(ENGINE, { STUB_GO_MOD: goMod });
    expect(run.urls).toContain(`${MODULE_PROXY_URL}/${ENGINE}.info`);
    expect(run.verifyArgs).toContain(`refs/tags/${ENGINE}`);
  });

  it.each(ENGINE_CASES)(
    '[SNP-13] refuses an engine it cannot tie to a tagged release: $name',
    row => {
      const run = runGate(ENGINE, row.stub);
      const downloads = run.urls.filter(url => url.startsWith(RELEASES_URL));
      expect(run.output).toContain(row.message);
      expect(downloads).toEqual([]);
      expect(run.verifyArgs).toEqual([]);
      expect(run.status).not.toBe(0);
    },
  );

  it('[SNP-14] says what it needs, before any download, when gh cannot pin a source commit', () => {
    const run = runGate(ENGINE, { STUB_GH_HELP: 'Usage: gh attestation verify' });
    expect(run.output).toContain("'gh attestation verify --source-digest'");
    expect(run.urls).toEqual([]);
    expect(run.status).not.toBe(0);
  });

  it.each(GH_CASES)(
    '[SNP-14] verifies only with a gh that matches the tag exactly: $version',
    row => {
      const run = runGate(ENGINE, { STUB_GH_VERSION: row.version });
      const didAskForNewerGh = run.output.includes(GH_NEEDED);
      expect(run.urls.length > 0).toBe(row.accepted);
      expect(run.verifyArgs.length > 0).toBe(row.accepted);
      expect(didAskForNewerGh).toBe(!row.accepted);
    },
  );

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
    const didReachDownload = run.output.includes(PROVENANCE_REJECTED);
    const fetched = row.accepted ? `${ACTION_GO_MOD_URL}/${ACTION_SHA}/go.mod` : '';
    expect(isPinRejected).toBe(!row.accepted);
    expect(didReachDownload).toBe(row.accepted);
    expect(run.goModUrl).toBe(fetched);
    expect(run.status).not.toBe(0);
  });

  it('[SNP-11] checks the engine of the action step the scheduled scan actually runs', () => {
    const refs = actionRefsIn(ACTION_WORKFLOW);
    const run = runGate(ENGINE);
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
