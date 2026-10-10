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
 * must need exactly `changes`. `pr.yml` conditions are compared after the
 * `${{ }}` wrapper and any nested whole-expression parentheses are removed.
 * Each PR-body gate in `pr-body-check.yml`, selected by step id, must
 * require `is-bot-pr.cjs` once at the top level, run only declarations
 * before it, and return on `isBotPr(pr)` before any enforcing call; the
 * inline script is parsed, so comments and string literals cannot satisfy
 * the check. `stage-body` must set `skip=true` for a bot PR, and the
 * cited-path check must run only when `skip != 'true'`. Exactly one
 * `chore` changelog section exists and it stays hidden, so the weekly
 * refresh never cuts a release note.
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

/** Jobs that must run when a lockfile-only PR changes `package-lock.json`. */
const DEPS_JOB_KEYS = ['unit-tests', 'e2e-factory', 'e2e-mocked'] as const;

/** The `deps` term each {@link DEPS_JOB_KEYS} job condition must keep. */
const DEPS_TERM = "needs.changes.outputs.deps == 'true'";

/** The only job in `pr-body-check.yml`. */
const PR_BODY_JOB = 'body-check';

/** Step ids of the scripted PR-body gates: the section check and the path-check staging. */
const PR_BODY_GATE_IDS = ['section-check', 'stage-body'] as const;

/** The action every scripted PR-body gate runs on. */
const GITHUB_SCRIPT_ACTION = 'actions/github-script@';

/** The workspace-relative tail of the shared bot-exemption module path. */
const IS_BOT_PR_SUFFIX = '/.github/scripts/ci/is-bot-pr.cjs';

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

/** Every known update type Renovate could open besides lockfile maintenance. */
const DISABLED_UPDATE_TYPES = [
  'major',
  'minor',
  'patch',
  'pin',
  'pinDigest',
  'digest',
  'rollback',
  'bump',
  'replacement',
] as const;

/**
 * The only packageRules allowed, minus their free-text descriptions. The
 * catch-all disables every named dependency — including update types a
 * future Renovate adds — while lockfile maintenance, which carries no
 * package name, never matches it. The update-type rule is defense in depth.
 */
const EXPECTED_PACKAGE_RULES = [
  { matchPackageNames: ['*'], enabled: false },
  { matchUpdateTypes: [...DISABLED_UPDATE_TYPES], enabled: false },
] as const;

/** Friday 00:00-05:59 — four days after Dependabot's Monday run. */
const EXPECTED_SCHEDULE = ['* 0-5 * * 5'] as const;

/**
 * Best-effort cooldown against freshly published (possibly hijacked)
 * versions. Renovate passes it to npm as `--before`, but drops the flag
 * and posts a PR notice when an already-locked package is newer than the
 * cutoff, so human review — not this value — is the fail-closed control.
 */
const EXPECTED_RELEASE_AGE = '3 days';

/** Node version CI installs; its bundled npm is {@link EXPECTED_NPM}. */
const EXPECTED_NODE = 'v22.14.0';

/** npm bundled with {@link EXPECTED_NODE}; Renovate must regenerate with it. */
const EXPECTED_NPM = '10.9.2';

/** Hosted-app preset that would otherwise inject merge-confidence badges. */
const EXPECTED_IGNORED_PRESETS = ['mergeConfidence:all-badges'] as const;

/** The single repo both pull-request heads and bases point at. */
const SAME_REPO = { full_name: 'sergienko4/israeli-bank-scrapers' } as const;

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
  if (typeof needs === 'string') {
    return [needs];
  }
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
  const depths = indices.map((index): number => {
    const prefix = expression.slice(0, index + 1);
    return depthAfter(prefix);
  });
  const firstClose = depths.indexOf(0);
  return expression.startsWith('(') && firstClose === expression.length - 1;
}

/**
 * Parenthesis nesting depth after reading a prefix.
 *
 * @param prefix - Characters read so far.
 * @returns Open minus close parentheses in the prefix.
 */
function depthAfter(prefix: string): number {
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
 * Read the literal text after the last `${…}` of a `require` argument.
 *
 * @param argument - The `require` call argument.
 * @returns The trailing literal text, empty for any other expression.
 */
function literalTail(argument: ts.Expression): string {
  if (ts.isTemplateExpression(argument)) return argument.templateSpans.at(-1)?.literal.text ?? '';
  if (ts.isStringLiteralLike(argument)) return argument.text;
  return '';
}

/**
 * Whether a node declares `isBotPr` as `require(<…/is-bot-pr.cjs>)`.
 *
 * @param node - Any script node.
 * @returns True for the shared-module require.
 */
function isBotPrRequire(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node) || node.name.getText() !== 'isBotPr') return false;
  const call = node.initializer;
  if (call === undefined || !ts.isCallExpression(call)) return false;
  const argument = call.arguments.at(0);
  if (call.expression.getText() !== 'require' || argument === undefined) return false;
  return literalTail(argument).endsWith(IS_BOT_PR_SUFFIX);
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
 * Whether a node is a call a bot PR must never reach: failing the check,
 * staging the body, or releasing the path check with `skip=false`.
 *
 * @param node - Any script node.
 * @returns True for an enforcing call.
 */
function isEnforcement(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression.getText();
  if (ENFORCING_CALLEES.has(callee)) return true;
  const value = node.arguments.at(1);
  const isFalse = value !== undefined && ts.isStringLiteralLike(value) && value.text === 'false';
  return callee === 'core.setOutput' && isFalse;
}

/**
 * Whether a node is `core.setOutput('skip', 'true')`.
 *
 * @param node - Any script node.
 * @returns True for the call that tells the path check to stand down.
 */
function isSkipTrue(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || node.expression.getText() !== 'core.setOutput') return false;
  const name = node.arguments.at(0);
  const value = node.arguments.at(1);
  const isSkip = name !== undefined && ts.isStringLiteralLike(name) && name.text === 'skip';
  return isSkip && value !== undefined && ts.isStringLiteralLike(value) && value.text === 'true';
}

/**
 * Whether a bot-exemption guard sets `skip=true` inside its branch.
 *
 * @param statement - The returning guard statement.
 * @returns True when the branch calls `core.setOutput('skip', 'true')`.
 */
function guardSetsSkip(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement)) return false;
  const branchNodes = nodesIn(statement.thenStatement);
  return branchNodes.some(isSkipTrue);
}

/**
 * List the `isBotPr` requires declared at the top level of a script, so a
 * require hidden in a block or function does not count.
 *
 * @param source - Parsed gate script.
 * @returns The top-level shared-module require declarations.
 */
function topLevelRequires(source: ts.SourceFile): readonly ts.VariableDeclaration[] {
  const variables = source.statements.filter(ts.isVariableStatement);
  const declarations = variables.flatMap(
    (statement): readonly ts.VariableDeclaration[] => statement.declarationList.declarations,
  );
  return declarations.filter(isBotPrRequire);
}

/**
 * Whether only declarations run before the guard, so no call can act on a
 * bot PR first.
 *
 * @param source - Parsed gate script.
 * @param guard - The returning bot-exemption guard.
 * @returns True when every earlier top-level statement is a declaration.
 */
function preGuardAreDeclarations(source: ts.SourceFile, guard: ts.Statement): boolean {
  const guardIndex = source.statements.indexOf(guard);
  const before = source.statements.slice(0, guardIndex);
  return guardIndex > 0 && before.every((statement): boolean => ts.isVariableStatement(statement));
}

/**
 * Find the body-check steps that run only when `stage-body` did not skip.
 *
 * @returns Every step gated on `steps.stage-body.outputs.skip != 'true'`.
 */
function stagedBodySteps(): readonly IWorkflowStep[] {
  const jobs = findJob(PR_BODY_JOB, PR_BODY_CHECK);
  const steps = jobs.flatMap((job): readonly IWorkflowStep[] => job.steps ?? []);
  return steps.filter((step): boolean => {
    const condition = typeof step.if === 'string' ? unwrapCondition(step.if) : '';
    return condition === STAGED_BODY_CONDITION;
  });
}

/**
 * Read the script of every `pr-body-check.yml` step with a given id.
 *
 * @param gateId - Step `id:` in the body-check job.
 * @returns One `uses`/script pair per matching step.
 */
function gateSteps(gateId: string): readonly IWorkflowStep[] {
  return stepsById(PR_BODY_JOB, gateId, PR_BODY_CHECK);
}

/**
 * Parse the committed release-please configuration.
 *
 * @returns Parsed config document.
 */
function loadReleasePlease(): IReleasePleaseConfig {
  const raw = read(RELEASE_PLEASE_CONFIG);
  return JSON.parse(raw) as IReleasePleaseConfig;
}

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
    expect(needs).toStrictEqual(['changes']);
    expect(isAdmitted).toBe(true);
  });

  it.each(PR_BODY_GATE_IDS)('[RLM-18] PrBodyCheck_%s_ShouldReturnForBotPrsFirst', gateId => {
    const steps = gateSteps(gateId);
    expect(steps).toHaveLength(1);
    const [step] = steps;
    const action = step.uses ?? '';
    const isScriptAction = action.startsWith(GITHUB_SCRIPT_ACTION);
    expect(isScriptAction).toBe(true);
    const source = parseScript(step.with?.script ?? '');
    const nodes = nodesIn(source);
    const requires = topLevelRequires(source);
    const guards = source.statements.filter(isReturningGuard);
    expect(requires).toHaveLength(1);
    expect(guards).toHaveLength(1);
    const isDeclarationsOnly = preGuardAreDeclarations(source, guards[0]);
    expect(isDeclarationsOnly).toBe(true);
    const requireEnd = requires[0].getEnd();
    const guardStart = guards[0].getStart();
    const guardEnd = guards[0].getEnd();
    expect(requireEnd).toBeLessThan(guardStart);
    const enforcing = nodes.filter(isEnforcement);
    const early = enforcing.filter((node): boolean => node.getStart() < guardEnd);
    expect(enforcing.length).toBeGreaterThan(0);
    expect(early).toStrictEqual([]);
  });

  it('[RLM-19] ReleasePlease_ChoreSection_ShouldStayHidden', () => {
    const config = loadReleasePlease();
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

  it('[RLM-21] PrBodyCheck_StageBody_ShouldSkipPathCheckForBotPrs', () => {
    const steps = gateSteps('stage-body');
    expect(steps).toHaveLength(1);
    const source = parseScript(steps[0].with?.script ?? '');
    const guards = source.statements.filter(isReturningGuard);
    expect(guards).toHaveLength(1);
    const isSkipSet = guardSetsSkip(guards[0]);
    expect(isSkipSet).toBe(true);
    const staged = stagedBodySteps();
    const runs = staged.map((step): string => runOf(step));
    expect(runs).toStrictEqual([PATH_CHECK_RUN]);
  });
});
