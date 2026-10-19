/**
 * Renovate lockfile-maintenance policy regression test.
 *
 * <p>Dependabot only refreshes a transitive dependency when it has an open
 * advisory, so transitives with no alert drift until the next manual
 * `npm update`. `renovate.json` closes that gap with a weekly
 * lockfile-only PR and nothing else: every other Renovate update type is
 * disabled because Dependabot already owns direct bumps and security
 * fixes, and two bots racing on the same manifests would double the PRs.
 *
 * <p>The config is easy to widen by accident — a dropped `packageRules`
 * entry, a re-enabled vulnerability lane or an inherited preset silently
 * turns Renovate into a second Dependabot. Its PRs also land on a
 * same-repo branch, so the real-bank gates must exclude `renovate[bot]`
 * exactly like `dependabot[bot]`, or bank secrets reach unreviewed install
 * scripts. This test pins every one of those values exactly.
 *
 * <p>The scripts only protect the repo while the workflows still call them,
 * so the test also pins that wiring: `pr.yml` must trigger on every PR to
 * `main` with no path filter, run the detector and the gate script
 * unconditionally, hand the gate the PR author, forward
 * `real_gates_enabled` to `validate`, and run the unit and both E2E jobs
 * whenever `deps` changes. The detector must flag `package-lock.json` as
 * `deps`, `changes` must export that flag, and each of those three jobs
 * must need exactly `changes`, plus the always-run `browser-stack` for
 * `e2e-mocked`. `pr.yml` conditions are compared after the
 * `${{ }}` wrapper and any nested whole-expression parentheses are removed.
 * Each PR-body gate in `pr-body-check.yml`, selected by step id, must
 * require `is-bot-pr.cjs` once at the top level and return on `isBotPr(pr)`
 * before any enforcing call. Before the guard, each gate declares exactly
 * its own set of approved `const` bindings, each with its exact
 * initializer, so none can be added or dropped. For a bot PR the guard
 * only calls `core.info` (in `stage-body`, then exactly
 * `core.setOutput('skip', 'true')`) before a bare `return`, no top-level
 * function is hoisted, and every `core.setOutput` call is pinned by text
 * and placement: none in `section-check`, and in `stage-body` the guard's
 * `skip=true` plus one unconditional top-level `skip=false`. The statements
 * after the `stage-body` guard are pinned verbatim, so the staged body
 * cannot be blanked or the skip flipped back. Neither gate step, nor the
 * `body-check` job, may set `if` or `continue-on-error`. The cited-path
 * check is found by its exact `run`, must exist once, run only when
 * `skip != 'true'` and never set `continue-on-error`. This is an exact
 * syntactic check of the parsed inline script, not a semantic proof: it
 * does not defend against deliberate obfuscation, which code-owner review
 * covers. Exactly one `chore` changelog section exists and it stays
 * hidden, so the weekly refresh never cuts a release note.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const RENOVATE_JSON = join(REPO_ROOT, 'renovate.json');
const NVMRC = join(REPO_ROOT, '.nvmrc');
const DETECTOR = join(REPO_ROOT, '.github/scripts/ci/detect-changes.sh');
const GATE_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/compute-gate-booleans.sh');
const BOT_PR_MODULE = join(REPO_ROOT, '.github/scripts/ci/is-bot-pr.cjs');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const PR_BODY_CHECK = join(REPO_ROOT, '.github/workflows/pr-body-check.yml');
const RELEASE_PLEASE_CONFIG = join(REPO_ROOT, 'release-please-config.json');

/**
 * Jobs that must run when a lockfile-only PR changes `package-lock.json`. In
 * `package-factory` the E2E factory step's own `deps` term is pinned by
 * `PackageFactoryJob` [PFJ-4].
 */
const DEPS_JOB_KEYS = ['unit-tests', 'e2e-mocked', 'package-factory'] as const;

/**
 * Extra `needs`, beyond `changes`, a {@link DEPS_JOB_KEYS} job waits for.
 * `browser-stack` has no job `if:` and passes when its steps are skipped,
 * so a dependency-only PR outside the browser stack still runs
 * `e2e-mocked`: `BrowserStackGateWiring` [BSW-5] pins that row.
 */
const DEPS_JOB_GATES = new Map<string, readonly string[]>([['e2e-mocked', ['browser-stack']]]);

/** The `deps` term each {@link DEPS_JOB_KEYS} job condition must keep. */
const DEPS_TERM = "needs.changes.outputs.deps == 'true'";

/** The only job in `pr-body-check.yml`. */
const PR_BODY_JOB = 'body-check';

/** Step ids of the scripted PR-body gates: the section check and the path-check staging. */
const PR_BODY_GATE_IDS = ['section-check', 'stage-body'] as const;

/** The action every scripted PR-body gate runs on. */
const GITHUB_SCRIPT_ACTION = 'actions/github-script@';

/**
 * The only `const` bindings a gate may declare before its guard, each
 * mapped to the exact initializer text it must use.
 */
const APPROVED_BINDINGS: ReadonlyMap<string, string> = new Map([
  ['fs', "require('node:fs')"],
  ['isBotPr', 'require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/ci/is-bot-pr.cjs`)'],
  ['pr', 'context.payload.pull_request'],
]);

/** Node kinds a `core.info` message may hold: literals, templates and plain reads. */
const INFO_ARGUMENT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.DotToken,
  ts.SyntaxKind.QuestionDotToken,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.SyntaxList,
]);

/** The exemption call each PR-body gate must branch on. */
const BOT_PR_GUARD = 'isBotPr(pr)';

/** Callees that fail the check or stage the body, the work a bot PR must skip. */
const ENFORCING_CALLEES: ReadonlySet<string> = new Set(['core.setFailed', 'fs.writeFileSync']);

/** The changelog entry that keeps Renovate's `chore(deps)` commits out of release notes. */
const HIDDEN_CHORE_SECTION = { type: 'chore', section: 'Miscellaneous', hidden: true };

/** A `${{ … }}` expression wrapper around a whole job condition. */
const EXPRESSION_WRAPPER = /^\$\{\{([\s\S]*)\}\}$/u;

/** One positive change-detection term, the only shape a deps condition may hold. */
const FLAG_TERM = /^needs\.changes\.outputs\.[a-z_]+ == 'true'$/u;

/** The `changes` job plus its detector and gate steps. */
const CHANGES_NODE_COUNT = 3;

/** The condition that runs a body-check step only when `stage-body` did not skip. */
const STAGED_BODY_CONDITION = "steps.stage-body.outputs.skip != 'true'";

/** The cited-path check a bot PR body must never reach. */
const PATH_CHECK_RUN = 'node scripts/check-doc-paths.mjs --diff-base "$BASE_SHA" pr-body-ci.md';

/** Version-bump update types Renovate could open besides lockfile maintenance. */
const VERSION_UPDATE_TYPES = ['major', 'minor', 'patch', 'pin', 'pinDigest', 'digest'] as const;

/** The remaining non-lockfile update types, in Renovate's documented order. */
const OTHER_UPDATE_TYPES = ['rollback', 'bump', 'replacement'] as const;

/**
 * The only packageRules allowed, minus their free-text descriptions. The
 * catch-all disables every named dependency — including update types a
 * future Renovate adds — while lockfile maintenance, which carries no
 * package name, never matches it. The update-type rule is defense in depth.
 */
const EXPECTED_PACKAGE_RULES = [
  { matchPackageNames: ['*'], enabled: false },
  { matchUpdateTypes: [...VERSION_UPDATE_TYPES, ...OTHER_UPDATE_TYPES], enabled: false },
] as const;

/**
 * Friday 00:00-05:59 Asia/Jerusalem, apart from Dependabot's Monday run.
 * The gap separates the two lanes; it guarantees no package age.
 */
const EXPECTED_SCHEDULE = ['* 0-5 * * 5'] as const;

/**
 * Best-effort only: Renovate lists lockFileMaintenance as not supporting
 * `minimumReleaseAge`. It passes a `--before` cutoff three days back; if
 * npm fails with `ETARGET` it retries without `--before` and logs a
 * warning, so a version published in the last three days can still land.
 * Human review limits exposure.
 */
const EXPECTED_RELEASE_AGE = '3 days';

/** Node build pin CI installs; its bundled npm is {@link EXPECTED_NPM}. */
const EXPECTED_NODE = 'v24.22.0';

/** npm bundled with {@link EXPECTED_NODE}; Renovate must regenerate with it. */
const EXPECTED_NPM = '11.19.1';

/** Hosted-app preset that would otherwise inject merge-confidence badges. */
const EXPECTED_IGNORED_PRESETS = ['mergeConfidence:all-badges'] as const;

/** The single repo both pull-request heads and bases point at. */
const SAME_REPO = { full_name: 'sergienko4/israeli-bank-scrapers' } as const;

/** The approved shared-module require every synthetic gate script starts with. */
const SAFE_REQUIRE =
  'const isBotPr = require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/ci/is-bot-pr.cjs`);';

/** The repo-relative path of the shared bot-PR module, leading slash included. */
const BOT_PR_PATH = '/.github/scripts/ci/is-bot-pr.cjs';

/** The exact statement a skip guard must run to mark the staged body skipped. */
const SKIP_TRUE = "core.setOutput('skip', 'true');";

/** The unconditional statement that lets `stage-body`'s path check run. */
const SKIP_FALSE = "core.setOutput('skip', 'false');";

/** Guard bodies that only look like they set `skip=true` and log, plus real ones. */
const SKIP_GUARD_CASES = [
  { label: 'deferred', body: "setTimeout(() => core.setOutput('skip', 'true'));", expected: false },
  { label: 'unreachable', body: "if (false) core.setOutput('skip', 'true');", expected: false },
  { label: 'early return', body: `if (pr.draft) return; ${SKIP_TRUE}`, expected: false },
  { label: 'short-circuit', body: "pr.draft && core.setOutput('skip', 'true');", expected: false },
  { label: 'missing', body: "core.info('x');", expected: false },
  { label: 'straight-line', body: `core.info('x'); ${SKIP_TRUE}`, expected: true },
  { label: 'reset', body: `${SKIP_TRUE} core['setOutput']('skip', 'false');`, expected: false },
  { label: 'optional', body: "core?.setOutput('skip', 'true');", expected: false },
  { label: 'optional call', body: "core.setOutput?.('skip', 'true');", expected: false },
  { label: 'third argument', body: "core.setOutput('skip', 'true', x);", expected: false },
  { label: 'spread', body: "core.setOutput(...['skip', 'true']);", expected: false },
  { label: 'call first', body: `explode(); ${SKIP_TRUE}`, expected: false },
  { label: 'template call', body: 'core.info(`${explode()}`); ' + SKIP_TRUE, expected: false },
  { label: 'real', body: "core.info(`${pr.user?.login ?? ''}`); " + SKIP_TRUE, expected: true },
] as const;

/** The approved built-in require the `stage-body` gate declares. */
const FS_REQUIRE = "const fs = require('node:fs');";

/** The pull-request binding every gate declares right before its guard. */
const PR_BINDING = 'const pr = context.payload.pull_request;';

/**
 * Pre-guard code for the `stage-body` bindings: a bad `fs` initializer or
 * keyword, a missing, extra or duplicate binding, plus the exact set.
 */
const PRE_GUARD_CASES = [
  { label: 'missing binding', code: '', expected: false },
  { label: 'call', code: "const fs = require('node:fs').writeFileSync('x', '');", expected: false },
  { label: 'constructor', code: 'const fs = new Job();', expected: false },
  { label: 'binding default', code: "const { fs = core.setFailed('x') } = {};", expected: false },
  { label: 'tagged template', code: 'const fs = core.setFailed`x`;', expected: false },
  { label: 'local require', code: "const fs = require('./side-effect.cjs');", expected: false },
  { label: 'assignment', code: 'const fs = (x = 1);', expected: false },
  { label: 'let', code: "let fs = require('node:fs');", expected: false },
  { label: 'using', code: "using fs = require('node:fs');", expected: false },
  { label: 'await using', code: "await using fs = require('node:fs');", expected: false },
  { label: 'reference', code: 'const fs = context.payload.pull_request.head;', expected: false },
  { label: 'wrong builtin', code: "const fs = require('node:path');", expected: false },
  { label: 'shadowed core', code: `${FS_REQUIRE}\nconst core = {};`, expected: false },
  { label: 'duplicate isBotPr', code: `${FS_REQUIRE}\n${SAFE_REQUIRE}`, expected: false },
  { label: 'duplicate pr', code: `${FS_REQUIRE}\n${PR_BINDING}`, expected: false },
  { label: 'exact set', code: FS_REQUIRE, expected: true },
] as const;

/** Shared-module requires whose arguments can or cannot run code first. */
const REQUIRE_CASES = [
  {
    label: 'call in path',
    code: "const isBotPr = require(`${core.setFailed('x')}/.github/scripts/ci/is-bot-pr.cjs`);",
    expected: false,
  },
  {
    label: 'extra argument',
    code: "const isBotPr = require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/ci/is-bot-pr.cjs`, core.setFailed('x'));",
    expected: false,
  },
  { label: 'absolute', code: `const isBotPr = require('/evil${BOT_PR_PATH}');`, expected: false },
  { label: 'relative', code: `const isBotPr = require('.${BOT_PR_PATH}');`, expected: false },
  { label: 'workspace path', code: SAFE_REQUIRE, expected: true },
] as const;

interface IPackageRule {
  readonly description?: string;
  readonly matchPackageNames?: readonly string[];
  readonly matchUpdateTypes?: readonly string[];
  readonly enabled?: boolean;
}

interface ILockFileMaintenance {
  readonly enabled?: boolean;
  readonly schedule?: readonly string[];
  readonly minimumReleaseAge?: string;
  readonly automerge?: boolean;
}

interface IRenovateConfig {
  readonly enabled?: boolean;
  readonly extends?: readonly string[];
  readonly ignorePresets?: readonly string[];
  readonly forkProcessing?: string;
  readonly enabledManagers?: readonly string[];
  readonly dependencyDashboard?: boolean;
  readonly vulnerabilityAlerts?: { readonly enabled?: boolean };
  readonly osvVulnerabilityAlerts?: boolean;
  readonly timezone?: string;
  readonly labels?: readonly string[];
  readonly semanticCommits?: string;
  readonly constraints?: { readonly npm?: string };
  readonly automerge?: boolean;
  readonly packageRules?: readonly IPackageRule[];
  readonly lockFileMaintenance?: ILockFileMaintenance;
}

interface IBotPrPayload {
  readonly user: { readonly login: string };
  readonly head: { readonly ref: string; readonly repo: typeof SAME_REPO };
  readonly base: { readonly repo: typeof SAME_REPO };
}

type IsBotPr = (pr: IBotPrPayload) => boolean;

/** Variable declarations collected from a script's statements. */
type Declarations = readonly ts.VariableDeclaration[];

interface IWorkflowStep {
  readonly id?: string;
  readonly if?: unknown;
  readonly run?: string;
  readonly uses?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: { readonly script?: string };
  readonly 'continue-on-error'?: unknown;
}

interface IWorkflowJob {
  readonly if?: unknown;
  readonly needs?: unknown;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly steps?: readonly IWorkflowStep[];
  readonly 'continue-on-error'?: unknown;
}

interface IPullRequestTrigger {
  readonly branches?: unknown;
  readonly paths?: unknown;
  readonly 'paths-ignore'?: unknown;
}

interface IWorkflowDoc {
  readonly on?: { readonly pull_request?: IPullRequestTrigger };
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

interface IChangelogSection {
  readonly type: string;
  readonly section: string;
  readonly hidden?: boolean;
}

interface IReleasePackage {
  readonly 'changelog-sections'?: readonly IChangelogSection[];
}

interface IReleasePleaseConfig {
  readonly packages?: Readonly<Partial<Record<string, IReleasePackage>>>;
}

interface IParsedGate {
  readonly source: ts.SourceFile;
  readonly guards: readonly ts.Statement[];
}

const LOAD_COMMON_JS = createRequire(import.meta.url);
const IS_BOT_PR = LOAD_COMMON_JS(BOT_PR_MODULE) as IsBotPr;

/**
 * Read a repo file as UTF-8 text.
 *
 * @param path - Absolute path to read.
 * @returns File contents.
 */
function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Parse the committed Renovate configuration.
 *
 * @returns Parsed config document.
 */
function loadConfig(): IRenovateConfig {
  const raw = read(RENOVATE_JSON);
  return JSON.parse(raw) as IRenovateConfig;
}

/**
 * Reduce a `packageRules` entry to its matching behaviour. Only the
 * free-text description is dropped, so any other key — `enabled: true`,
 * `force`, a new matcher — still fails the exact comparison.
 *
 * @param rule - One parsed `packageRules` entry.
 * @returns The rule without its `description`.
 */
function ruleBehaviour(rule: IPackageRule): Readonly<Record<string, unknown>> {
  const entries = Object.entries(rule);
  const behaviour = entries.filter(([key]): boolean => key !== 'description');
  return Object.fromEntries(behaviour);
}

/**
 * Build a same-repo pull-request payload for the bot-exemption check.
 *
 * @param login - PR author login.
 * @param ref - Head branch name.
 * @returns Minimal `pull_request` payload.
 */
function sameRepoPr(login: string, ref: string): IBotPrPayload {
  return { user: { login }, head: { ref, repo: SAME_REPO }, base: { repo: SAME_REPO } };
}

/**
 * Parse a committed workflow file.
 *
 * <p>The cast matches the sibling CrossValidation gates. A document that is
 * not a mapping either throws on first access or yields no jobs, so every
 * assertion below fails rather than passes.
 *
 * @param path - Absolute workflow path.
 * @returns Parsed workflow document.
 */
function loadWorkflow(path: string): IWorkflowDoc {
  const raw = read(path);
  return parse(raw) as IWorkflowDoc;
}

/**
 * Find every job registered under a workflow key.
 *
 * @param key - YAML job key under `jobs:`.
 * @param path - Absolute workflow path, `pr.yml` by default.
 * @returns Zero or one matching job definition.
 */
function findJob(key: string, path = PR_YAML): readonly IWorkflowJob[] {
  const doc = loadWorkflow(path);
  const entries = Object.entries(doc.jobs ?? {});
  const matched = entries.filter(([name]): boolean => name === key);
  return matched.map(([, job]): IWorkflowJob => job);
}

/**
 * Normalise a `needs:` value, which YAML allows as a string or a list.
 *
 * @param needs - Raw `needs:` value.
 * @returns The job keys it names, empty when absent or malformed.
 */
function needsList(needs: unknown): readonly string[] {
  if (typeof needs === 'string') return [needs];
  const list: readonly unknown[] = Array.isArray(needs) ? needs : [];
  return list.filter((need): need is string => typeof need === 'string');
}

/**
 * Resolve the jobs a `pr.yml` job waits on.
 *
 * @param key - YAML job key under `jobs:`.
 * @returns Every job key under its `needs:`, empty when the job is absent.
 */
function needsOf(key: string): readonly string[] {
  const matched = findJob(key);
  return matched.flatMap((job): readonly string[] => needsList(job.needs));
}

/**
 * Resolve a job's `if:` expression as a string.
 *
 * @param key - YAML job key under `jobs:`.
 * @returns The condition text, or an empty string when absent.
 */
function jobCondition(key: string): string {
  const matched = findJob(key);
  const conditions = matched.map((job): string => (typeof job.if === 'string' ? job.if : ''));
  return conditions.join('');
}

/**
 * Resolve one declared output expression of a job.
 *
 * @param key - YAML job key under `jobs:`.
 * @param name - Output name under the job's `outputs:`.
 * @returns The expression text, or an empty string when absent.
 */
function jobOutput(key: string, name: string): string {
  const matched = findJob(key);
  const values = matched.map((job): string => job.outputs?.[name] ?? '');
  return values.join('');
}

/**
 * Find every step with a given `id:` in a job.
 *
 * @param jobKey - YAML job key under `jobs:`.
 * @param stepId - Exact `id:` of the step to match.
 * @param path - Absolute workflow path, `pr.yml` by default.
 * @returns Every matching step, empty when none.
 */
function stepsById(jobKey: string, stepId: string, path = PR_YAML): readonly IWorkflowStep[] {
  const matched = findJob(jobKey, path);
  const steps = matched.flatMap((job): readonly IWorkflowStep[] => job.steps ?? []);
  return steps.filter((step): boolean => step.id === stepId);
}

/**
 * Read a step's `run:` body without surrounding whitespace, so moving the
 * command into a block scalar does not change what is compared.
 *
 * @param step - Step definition.
 * @returns The trimmed command, empty when absent.
 */
function runOf(step: IWorkflowStep): string {
  const run = step.run ?? '';
  return run.trim();
}

/**
 * Collect the keys that can skip a job or step or hide its failure.
 *
 * @param node - A job or step definition.
 * @returns Its `if:` and `continue-on-error:` values, `undefined` when unset.
 */
function failureMasks(node: IWorkflowJob | IWorkflowStep): readonly unknown[] {
  return [node.if, node['continue-on-error']];
}

/**
 * Whether a job condition is true whenever one given flag is.
 *
 * <p>Containing the term is not enough: `... deps == 'true' && false`
 * contains it and never runs, and a skipped job reports success to
 * `validate`. Only a disjunction of positive flag comparisons is true
 * whenever one of its flags is, so any conjunction, negation or literal
 * fails. An empty condition fails too: {@link jobCondition} returns one for
 * a missing job and for a non-string `if: false` alike.
 *
 * @param term - The flag comparison that must be present.
 * @param condition - Raw `if:` expression.
 * @returns True when a change setting only that flag runs the job.
 */
function admitsFlag(term: string, condition: string): boolean {
  const collapsed = unwrapCondition(condition);
  const terms = collapsed.split('||').map((entry): string => entry.trim());
  const isPureOrChain = terms.every((entry): boolean => FLAG_TERM.test(entry));
  return isPureOrChain && terms.includes(term);
}

/**
 * Reduce a job condition to its bare expression, so `${{ a || b }}`,
 * `(a || b)` and `((a || b))` are judged exactly like `a || b`. Each outer
 * pair that wraps the whole expression is removed, however deeply nested.
 *
 * @param condition - Raw `if:` value.
 * @returns The single-spaced expression without its wrappers.
 */
function unwrapCondition(condition: string): string {
  const trimmed = condition.trim();
  const wrapped = EXPRESSION_WRAPPER.exec(trimmed);
  const inner = wrapped ? wrapped[1] : trimmed;
  const collapsed = inner.replaceAll(/\s+/gu, ' ').trim();
  if (!closesAtEnd(collapsed)) return collapsed;
  const unwrapped = collapsed.slice(1, -1);
  return unwrapCondition(unwrapped);
}

/**
 * Whether one `( … )` pair wraps the whole expression. `(a) || (b)` opens
 * and ends with a parenthesis, yet its first pair closes early, so it is
 * not wrapped.
 *
 * @param expression - Single-spaced expression.
 * @returns True when the opening parenthesis closes at the last character.
 */
function closesAtEnd(expression: string): boolean {
  const indices = Array.from({ length: expression.length }, (_unused, index): number => index);
  const depths = indices.map((index): number => depthAfter(expression, index + 1));
  const firstClose = depths.indexOf(0);
  return expression.startsWith('(') && firstClose === expression.length - 1;
}

/**
 * Parenthesis nesting depth after reading the first characters.
 *
 * @param expression - Single-spaced expression.
 * @param end - How many leading characters are read.
 * @returns Open minus close parentheses in that prefix.
 */
function depthAfter(expression: string, end: number): number {
  const prefix = expression.slice(0, end);
  const opens = prefix.replaceAll(/[^(]/gu, '').length;
  const closes = prefix.replaceAll(/[^)]/gu, '').length;
  return opens - closes;
}

/**
 * Parse an inline github-script body as JavaScript. The action wraps it in
 * an async function, so a top-level `return` still parses as a statement.
 *
 * @param script - Script text from a workflow step.
 * @returns The parsed source file with parent links set.
 */
function parseScript(script: string): ts.SourceFile {
  return ts.createSourceFile('gate.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/**
 * List a node and every descendant in source order.
 *
 * @param node - Root node.
 * @returns The node followed by all of its descendants.
 */
function nodesIn(node: ts.Node): readonly ts.Node[] {
  const children = node.getChildren().flatMap((child): readonly ts.Node[] => nodesIn(child));
  return [node, ...children];
}

/**
 * Whether a declaration binds an approved name to its exact approved
 * initializer, so no pre-guard binding can run other code.
 *
 * @param declaration - A top-level `const` declaration.
 * @returns True for an approved binding; destructuring is rejected.
 */
function isApprovedBinding(declaration: ts.VariableDeclaration): boolean {
  const { name, initializer } = declaration;
  if (!ts.isIdentifier(name) || initializer === undefined) return false;
  return APPROVED_BINDINGS.get(name.text) === initializer.getText();
}

/**
 * Whether a statement is `if (isBotPr(pr))` whose branch ends in `return`.
 *
 * @param statement - A top-level script statement.
 * @returns True for a returning bot-exemption guard.
 */
function isReturningGuard(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement) || statement.expression.getText() !== BOT_PR_GUARD) return false;
  const branch = statement.thenStatement;
  const last = ts.isBlock(branch) ? branch.statements.at(-1) : branch;
  return last !== undefined && ts.isReturnStatement(last);
}

/**
 * Whether a node is a call a bot PR must never reach: failing the check
 * or staging the body. `core.setOutput` calls are pinned separately.
 *
 * @param node - Any script node.
 * @returns True for an enforcing call.
 */
function isEnforcement(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = calleeName(node);
  return ENFORCING_CALLEES.has(callee);
}

/**
 * Name a call's callee as `owner.member`, folding optional chaining and a
 * string-keyed element access, so `core?.setFailed` and
 * `core['setFailed']` match the same entry as `core.setFailed`.
 *
 * @param call - Any call expression.
 * @returns The normalized callee name, or the raw callee text.
 */
function calleeName(call: ts.CallExpression): string {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return `${callee.expression.getText()}.${callee.name.text}`;
  }
  if (!ts.isElementAccessExpression(callee)) return callee.getText();
  const key = callee.argumentExpression;
  if (!ts.isStringLiteralLike(key)) return callee.getText();
  return `${callee.expression.getText()}.${key.text}`;
}

/**
 * Whether a node is a plain `object.name(…)` call with no optional
 * chaining, so the call can be neither skipped nor redirected.
 *
 * @param node - Any script node.
 * @param object - The receiver identifier, such as `core`.
 * @param name - The method name.
 * @returns True for the exact, non-optional method call.
 */
function isPlainCall(node: ts.Node, object: string, name: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.questionDotToken !== undefined) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) return false;
  const isObject = ts.isIdentifier(callee.expression) && callee.expression.text === object;
  return isObject && callee.name.text === name;
}

/**
 * Whether a node is exactly `core.setOutput('skip', 'true')`.
 *
 * @param node - Any script node.
 * @returns True for the call that tells the path check to stand down.
 */
function isSkipTrueCall(node: ts.Node): boolean {
  if (!isPlainCall(node, 'core', 'setOutput') || node.arguments.length !== 2) return false;
  const [name, value] = node.arguments;
  const isSkip = ts.isStringLiteral(name) && name.text === 'skip';
  return isSkip && ts.isStringLiteral(value) && value.text === 'true';
}

/**
 * Whether a statement is `core.info(<message>)` whose single message only
 * holds literals, templates and plain reads, so logging runs no other code.
 *
 * @param statement - A guard-body statement.
 * @returns True for an inert log call.
 */
function isInertInfoStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  const call = statement.expression;
  if (!isPlainCall(call, 'core', 'info') || call.arguments.length !== 1) return false;
  const [message] = call.arguments;
  return nodesIn(message).every((node): boolean => INFO_ARGUMENT_KINDS.has(node.kind));
}

/**
 * Whether a statement list ends in a `return` with no value.
 *
 * @param statements - Block statements.
 * @returns True when the last statement is a bare `return`.
 */
function endsInBareReturn(statements: readonly ts.Statement[]): boolean {
  const last = statements.at(-1);
  if (last === undefined || !ts.isReturnStatement(last)) return false;
  return last.expression === undefined;
}

/**
 * List the statements a guard runs before its final bare `return`.
 *
 * @param statement - The returning guard statement.
 * @returns The block statements before the `return`, or none when the
 * guard is not a block ending in a bare `return`.
 */
function guardPrelude(statement: ts.Statement): readonly ts.Statement[] {
  if (!ts.isIfStatement(statement) || !ts.isBlock(statement.thenStatement)) return [];
  const body = statement.thenStatement.statements;
  return endsInBareReturn(body) ? body.slice(0, -1) : [];
}

/**
 * Whether a guard only logs with inert `core.info` calls before a bare
 * `return`, so a bot PR runs no other code in `section-check`.
 *
 * @param statement - The returning guard statement.
 * @returns True for a log-only guard body.
 */
function guardOnlyLogs(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement) || !ts.isBlock(statement.thenStatement)) return false;
  const isReturn = endsInBareReturn(statement.thenStatement.statements);
  return isReturn && guardPrelude(statement).every(isInertInfoStatement);
}

/**
 * Whether a guard runs inert `core.info` calls, then exactly
 * `core.setOutput('skip', 'true')`, then a bare `return`, so the output
 * cannot be deferred, reset, skipped or made conditional.
 *
 * @param statement - The returning guard statement.
 * @returns True for the exact `stage-body` guard shape.
 */
function guardSetsSkip(statement: ts.Statement): boolean {
  const prelude = guardPrelude(statement);
  const last = prelude.at(-1);
  const isSkip = last !== undefined && ts.isExpressionStatement(last);
  const isSkipCall = isSkip && isSkipTrueCall(last.expression);
  return isSkipCall && prelude.slice(0, -1).every(isInertInfoStatement);
}

/**
 * Flatten the declarations of the variable statements in a list.
 *
 * @param statements - Script statements.
 * @returns Every declaration made by a variable statement in the list.
 */
function variableDeclarations(statements: readonly ts.Statement[]): Declarations {
  const variables = statements.filter(ts.isVariableStatement);
  return variables.flatMap((statement): Declarations => statement.declarationList.declarations);
}

/**
 * List the `isBotPr` requires declared at the top level of a script, so a
 * require hidden in a block or function does not count.
 *
 * @param source - Parsed gate script.
 * @returns The top-level shared-module require declarations.
 */
function topLevelRequires(source: ts.SourceFile): Declarations {
  const approved = variableDeclarations(source.statements).filter(isApprovedBinding);
  return approved.filter((node): boolean => node.name.getText() === 'isBotPr');
}

/**
 * Whether a statement is a `const` declaration, so `let`, `var`, `using`
 * and `await using` (which runs a disposer) are all rejected.
 *
 * @param statement - A top-level script statement.
 * @returns True for a `const` variable statement.
 */
function isConstStatement(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.getFirstToken()?.kind === ts.SyntaxKind.ConstKeyword;
}

/**
 * Whether the gate declares exactly its required `const` bindings before
 * the guard, each once and with its exact initializer, so no call can act
 * on a bot PR first and no binding can be dropped. Fails closed.
 *
 * @param guard - The returning bot-exemption guard.
 * @param required - The distinct binding names this gate must declare.
 * @returns True when the earlier top-level statements are `const`
 * declarations of exactly the required approved bindings.
 */
function preGuardHasExactBindings(guard: ts.Statement, required: readonly string[]): boolean {
  const { statements } = guard.getSourceFile();
  const guardIndex = statements.indexOf(guard);
  const before = statements.slice(0, guardIndex);
  if (guardIndex <= 0 || !before.every(isConstStatement)) return false;
  const declarations = variableDeclarations(before);
  const names = declarations.map((declaration): string => declaration.name.getText());
  const hasEach = required.every((name): boolean => names.includes(name));
  return hasEach && names.length === required.length && declarations.every(isApprovedBinding);
}

/**
 * List every `core.setOutput` call with its placement, so an output cannot
 * be dropped, flipped, made conditional, or added.
 *
 * @param source - Parsed gate script.
 * @returns Each call as `top <text>` for a top-level statement, else
 * `nested <text>`, in source order.
 */
function outputCalls(source: ts.SourceFile): readonly string[] {
  const nodes = nodesIn(source);
  const calls = nodes.filter(ts.isCallExpression);
  const outputs = calls.filter((call): boolean => calleeName(call) === 'core.setOutput');
  return outputs.map((call): string => {
    const isTop = ts.isExpressionStatement(call.parent) && call.parent.parent === source;
    return `${isTop ? 'top' : 'nested'} ${call.getText()}`;
  });
}

/**
 * Build a minimal gate script so the guard helpers can be shown to reject
 * code that only looks safe.
 *
 * @param preGuard - Statements placed before the guard.
 * @param guardBody - Statements placed before the guard's `return`.
 * @returns The parsed script and its returning guards.
 */
function syntheticGate(preGuard: string, guardBody: string): IParsedGate {
  const lines = [preGuard, PR_BINDING];
  const guard = ['if (isBotPr(pr)) {', guardBody, 'return;', '}', "core.setFailed('x');"];
  const script = [...lines, ...guard].join('\n');
  const source = parseScript(script);
  const guards = source.statements.filter(isReturningGuard);
  return { source, guards };
}

/**
 * The exact shape each real gate must keep: its pre-guard bindings, its
 * guard body, every `core.setOutput` call with its placement and, for
 * `stage-body`, its exact post-guard statements.
 */
const GATE_SHAPES = {
  'section-check': { bindings: ['isBotPr', 'pr'], guardBody: guardOnlyLogs, outputs: [] },
  'stage-body': {
    bindings: ['fs', 'isBotPr', 'pr'],
    guardBody: guardSetsSkip,
    outputs: ["nested core.setOutput('skip', 'true')", "top core.setOutput('skip', 'false')"],
    postGuard: ["fs.writeFileSync('pr-body-ci.md', pr.body || '');", SKIP_FALSE],
  },
} as const;

describe('RenovateLockfileMaintenancePolicy', () => {
  it('[RLM-1] Config_OnlyLockFileMaintenance_ShouldBeEnabled', () => {
    const config = loadConfig();
    expect(config.enabled).toBeUndefined();
    expect(config.lockFileMaintenance?.enabled).toBe(true);
  });

  it('[RLM-2] Config_PackageRules_ShouldDisableEveryDependencyUpdate', () => {
    const config = loadConfig();
    const rules = config.packageRules ?? [];
    const behaviours = rules.map(ruleBehaviour);
    expect(behaviours).toStrictEqual(EXPECTED_PACKAGE_RULES);
  });

  it('[RLM-3] Config_SecurityAndDashboardLanes_ShouldStayOff', () => {
    const config = loadConfig();
    expect(config.vulnerabilityAlerts?.enabled).toBe(false);
    expect(config.osvVulnerabilityAlerts).toBe(false);
    expect(config.dependencyDashboard).toBe(false);
  });

  it('[RLM-4] Config_ForkAndManagerScope_ShouldBeNpmOnFork', () => {
    const config = loadConfig();
    expect(config.forkProcessing).toBe('enabled');
    expect(config.enabledManagers).toStrictEqual(['npm']);
  });

  it('[RLM-5] Config_LockFileMaintenance_ShouldNeverAutomergeAndShouldRequestCooldown', () => {
    const config = loadConfig();
    expect(config.automerge).not.toBe(true);
    expect(config.lockFileMaintenance?.automerge).toBe(false);
    expect(config.lockFileMaintenance?.minimumReleaseAge).toBe(EXPECTED_RELEASE_AGE);
  });

  it('[RLM-6] Config_Schedule_ShouldBeFridayInIsraelTime', () => {
    const config = loadConfig();
    expect(config.lockFileMaintenance?.schedule).toStrictEqual([...EXPECTED_SCHEDULE]);
    expect(config.timezone).toBe('Asia/Jerusalem');
  });

  it('[RLM-7] Config_Presets_ShouldInheritNothing', () => {
    const config = loadConfig();
    expect(config.extends).toStrictEqual([]);
    expect(config.ignorePresets).toStrictEqual([...EXPECTED_IGNORED_PRESETS]);
  });

  it('[RLM-8] Config_PrShape_ShouldMatchRepoConventions', () => {
    const config = loadConfig();
    expect(config.semanticCommits).toBe('enabled');
    expect(config.labels).toStrictEqual(['dependencies']);
  });

  it('[RLM-9] Config_NpmConstraint_ShouldMatchCiNode', () => {
    const ciNode = read(NVMRC).trim();
    const config = loadConfig();
    expect(ciNode).toBe(EXPECTED_NODE);
    expect(config.constraints?.npm).toBe(EXPECTED_NPM);
  });

  it('[RLM-10] Detector_DepsFlag_ShouldTrackLockfileAndRenovateConfig', () => {
    const script = read(DETECTOR);
    const depsRule = script.split('\n').find((line): boolean => line.includes('then deps=true'));
    const depsOutput = jobOutput('changes', 'deps');
    expect(depsRule).toContain(String.raw`^package-lock\.json$`);
    expect(depsRule).toContain(String.raw`^renovate\.json$`);
    expect(depsOutput).toBe('${{ steps.changes.outputs.deps }}');
  });

  it('[RLM-11] GateScript_RealGates_ShouldExcludeBothDependencyBots', () => {
    const script = read(GATE_SCRIPT);
    expect(script).toContain('"dependabot[bot]" | "renovate[bot]") return 0 ;;');
    expect(script).toContain('! is_dependency_bot_pr');
  });

  it('[RLM-12] BotPr_RenovateAuthor_ShouldBeExempt', () => {
    const payload = sameRepoPr('renovate[bot]', 'renovate/lock-file-maintenance');
    const isExempt = IS_BOT_PR(payload);
    expect(isExempt).toBe(true);
  });

  it('[RLM-13] BotPr_HumanOnRenovateBranch_ShouldNotBeExempt', () => {
    const payload = sameRepoPr('octocat', 'renovate/lock-file-maintenance');
    const isExempt = IS_BOT_PR(payload);
    expect(isExempt).toBe(false);
  });

  it('[RLM-14] PrYaml_ChangesJob_ShouldRunDetectorAndGateWithPrAuthor', () => {
    const detector = stepsById('changes', 'changes');
    const gate = stepsById('changes', 'gate');
    const detectorRuns = detector.map((step): string => runOf(step));
    const gateRuns = gate.map((step): string => runOf(step));
    const authors = gate.map((step): string => step.env?.PR_AUTHOR ?? '');
    expect(detectorRuns).toStrictEqual(['bash .github/scripts/ci/detect-changes.sh']);
    expect(gateRuns).toStrictEqual(['bash .github/scripts/ci/compute-gate-booleans.sh']);
    expect(authors).toStrictEqual(['${{ github.event.pull_request.user.login }}']);
  });

  it('[RLM-15] PrYaml_ChangesJobAndSteps_ShouldBeUnconditional', () => {
    const job = findJob('changes');
    const detector = stepsById('changes', 'changes');
    const gate = stepsById('changes', 'gate');
    const nodes = [...job, ...detector, ...gate];
    const masks = nodes.flatMap((node): readonly unknown[] => failureMasks(node));
    const masked = masks.filter((mask): boolean => mask !== undefined);
    expect(nodes).toHaveLength(CHANGES_NODE_COUNT);
    expect(masked).toStrictEqual([]);
  });

  it('[RLM-16] PrYaml_RealGatesFlag_ShouldFlowFromGateScriptToValidate', () => {
    const fromGate = jobOutput('changes', 'real_gates_enabled');
    const fromChanges = jobOutput('validate', 'real_gates_enabled');
    const validateNeeds = needsOf('validate');
    expect(fromGate).toBe('${{ steps.gate.outputs.real_gates_enabled }}');
    expect(fromChanges).toBe('${{ needs.changes.outputs.real_gates_enabled }}');
    expect(validateNeeds).toContain('changes');
  });

  it.each(DEPS_JOB_KEYS)('[RLM-17] PrYaml_%s_ShouldRunWheneverDepsChange', jobKey => {
    const condition = jobCondition(jobKey);
    const needs = needsOf(jobKey);
    const isAdmitted = admitsFlag(DEPS_TERM, condition);
    expect(needs).toStrictEqual(['changes', ...(DEPS_JOB_GATES.get(jobKey) ?? [])]);
    expect(isAdmitted).toBe(true);
  });

  it.each(PR_BODY_GATE_IDS)('[RLM-18] PrBodyCheck_%s_ShouldReturnForBotPrsFirst', gateId => {
    const shape = GATE_SHAPES[gateId];
    const steps = stepsById(PR_BODY_JOB, gateId, PR_BODY_CHECK);
    expect(steps).toHaveLength(1);
    const [step] = steps;
    const stepMasks = failureMasks(step).filter((mask): boolean => mask !== undefined);
    expect(stepMasks).toStrictEqual([]);
    const isScriptAction = (step.uses ?? '').startsWith(GITHUB_SCRIPT_ACTION);
    expect(isScriptAction).toBe(true);
    const source = parseScript(step.with?.script ?? '');
    const guards = source.statements.filter(isReturningGuard);
    expect(guards).toHaveLength(1);
    const isExactBindings = preGuardHasExactBindings(guards[0], shape.bindings);
    expect(isExactBindings).toBe(true);
    const isGuardBodyOk = shape.guardBody(guards[0]);
    expect(isGuardBodyOk).toBe(true);
    const outputs = outputCalls(source);
    expect(outputs).toStrictEqual(shape.outputs);
    const guardIndex = source.statements.indexOf(guards[0]);
    const post = source.statements.slice(guardIndex + 1);
    const postText = post.map((statement): string => statement.getText());
    const expectedPost = 'postGuard' in shape ? [...shape.postGuard] : postText;
    expect(postText).toStrictEqual(expectedPost);
    const hoisted = source.statements.filter(ts.isFunctionDeclaration);
    expect(hoisted).toStrictEqual([]);
    const guardEnd = guards[0].getEnd();
    const enforcing = nodesIn(source).filter(isEnforcement);
    const early = enforcing.filter((node): boolean => node.getStart() < guardEnd);
    expect(enforcing.length).toBeGreaterThan(0);
    expect(early).toStrictEqual([]);
  });

  it('[RLM-19] ReleasePlease_ChoreSection_ShouldStayHidden', () => {
    const raw = read(RELEASE_PLEASE_CONFIG);
    const config = JSON.parse(raw) as IReleasePleaseConfig;
    const sections = config.packages?.['.']?.['changelog-sections'] ?? [];
    const chores = sections.filter((section): boolean => section.type === 'chore');
    expect(chores).toStrictEqual([HIDDEN_CHORE_SECTION]);
  });

  it('[RLM-20] PrYaml_Trigger_ShouldRunOnEveryPrToMain', () => {
    const doc = loadWorkflow(PR_YAML);
    const trigger = doc.on?.pull_request;
    expect(trigger).toBeDefined();
    expect(trigger?.branches).toStrictEqual(['main']);
    expect(trigger?.paths).toBeUndefined();
    expect(trigger?.['paths-ignore']).toBeUndefined();
  });

  it('[RLM-21] PrBodyCheck_PathCheck_ShouldRunOnlyWhenNotSkipped', () => {
    const jobs = findJob(PR_BODY_JOB, PR_BODY_CHECK);
    const jobMasks = jobs.flatMap((job): readonly unknown[] => failureMasks(job));
    const setJobMasks = jobMasks.filter((mask): boolean => mask !== undefined);
    expect(setJobMasks).toStrictEqual([]);
    const steps = jobs.flatMap((job): readonly IWorkflowStep[] => job.steps ?? []);
    const pathChecks = steps.filter((step): boolean => runOf(step) === PATH_CHECK_RUN);
    expect(pathChecks).toHaveLength(1);
    const [check] = pathChecks;
    const condition = unwrapCondition(typeof check.if === 'string' ? check.if : '');
    expect(condition).toBe(STAGED_BODY_CONDITION);
    expect(check['continue-on-error']).toBeUndefined();
  });

  it.each(SKIP_GUARD_CASES)(
    '[RLM-22] GuardSetsSkip_ShouldRequireStraightLineSkip ($label)',
    ({ body, expected }) => {
      const { guards } = syntheticGate(SAFE_REQUIRE, body);
      expect(guards).toHaveLength(1);
      const isSkipSet = guardSetsSkip(guards[0]);
      expect(isSkipSet).toBe(expected);
    },
  );

  it.each(PRE_GUARD_CASES)(
    '[RLM-23] PreGuard_ShouldAllowOnlyExactBindings ($label)',
    ({ code, expected }) => {
      const { guards } = syntheticGate(`${SAFE_REQUIRE}\n${code}`, '');
      expect(guards).toHaveLength(1);
      const isExact = preGuardHasExactBindings(guards[0], GATE_SHAPES['stage-body'].bindings);
      expect(isExact).toBe(expected);
    },
  );

  it.each(REQUIRE_CASES)(
    '[RLM-24] BotPrRequire_ShouldRejectArgumentsThatRunCode ($label)',
    ({ code, expected }) => {
      const { source, guards } = syntheticGate(code, '');
      const requires = topLevelRequires(source);
      expect(requires).toHaveLength(expected ? 1 : 0);
      const isExact = preGuardHasExactBindings(guards[0], GATE_SHAPES['section-check'].bindings);
      expect(isExact).toBe(expected);
    },
  );
});
