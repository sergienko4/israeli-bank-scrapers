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
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const RENOVATE_JSON = join(REPO_ROOT, 'renovate.json');
const NVMRC = join(REPO_ROOT, '.nvmrc');
const DETECTOR = join(REPO_ROOT, '.github/scripts/ci/detect-changes.sh');
const GATE_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/compute-gate-booleans.sh');
const BOT_PR_MODULE = join(REPO_ROOT, '.github/scripts/ci/is-bot-pr.cjs');

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

  it('[RLM-10] Detector_DepsFlag_ShouldTrackRenovateConfig', () => {
    const script = read(DETECTOR);
    const depsRule = script.split('\n').find((line): boolean => line.includes('then deps=true'));
    expect(depsRule).toContain(String.raw`^renovate\.json$`);
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
});
