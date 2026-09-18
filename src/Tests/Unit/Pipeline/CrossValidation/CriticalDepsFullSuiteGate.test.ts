/**
 * CI critical-dependency gate regression test.
 *
 * <p>The browser stack — `playwright-core` and Camoufox — IS the runtime
 * for all 17 banks. A bump there changes real navigation, anti-bot
 * fingerprinting and frame handling, yet it touches no `src/` file, so
 * every `src`-gated job used to skip. The 1.61.0
 * `Browser.setDefaultViewport` regression that broke `browser.newContext`
 * reached main exactly that way.
 *
 * <p>`detect-changes.sh` therefore emits `critical_deps` (the browser
 * stack moved) and `full_suite` (`src OR critical_deps`). This test pins
 * the wiring: every heavy job must gate on `full_suite`, so re-adding a
 * `src`-only gate fails here instead of silently shrinking coverage.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const DETECTOR = join(REPO_ROOT, '.github/scripts/ci/detect-changes.sh');
const GATE_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/compute-gate-booleans.sh');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

/** Jobs that must run whenever the browser stack moves, not just on `src`. */
const HEAVY_JOB_KEYS = [
  'unit-tests',
  'e2e-factory',
  'e2e-mocked',
  'bank-coverage',
  'integration',
  'build',
] as const;

/** Runtime packages whose version defines the browser stack. */
const CRITICAL_PACKAGES = ['playwright-core', '@hieutran094/camoufox-js'] as const;

/**
 * Paths that define the published API surface or the gate guarding it.
 *
 * <p>`full_suite` is `src OR critical_deps`, so a snapshot-only or
 * checker-only edit left the Build job — and with it the public-surface
 * gate — skipped. These must keep feeding the separate `public_surface`
 * flag.
 */
const PUBLIC_SURFACE_PATHS = [
  '^api-surface\\.d\\.ts$',
  '^scripts/check-public-surface\\.mjs$',
  '^tsup\\.config\\.ts$',
  '^tsconfig\\.build\\.json$',
  '^tsconfig\\.json$',
  '^package\\.json$',
  '^package-lock\\.json$',
  '\\.github/actions/build-package/',
] as const;

/**
 * Every surface that must keep invoking the public-API checker.
 *
 * The gate is only as real as its wiring. Deleting the invocation from
 * any one of these would leave the whole apparatus in place and green
 * while nothing was actually compared — the exact failure mode this
 * checker was introduced to end.
 */
const CHECKER_CALL_SITES = [
  ['.github/actions/build-package/action.yml', 'npm run lint:public-surface'],
  ['.husky/pre-commit', 'npm run lint:public-surface'],
] as const;

/**
 * The exact command `lint:public-surface` must run. Asserting the whole
 * string rather than a substring matters: `api:update` invokes the same
 * script with `--update`, so a `toContain('check-public-surface.mjs')`
 * check on package.json passes even if `lint:public-surface` is gutted.
 */
const CHECK_SCRIPT_COMMAND = 'node scripts/check-public-surface.mjs --check';

/** The three `$GITHUB_OUTPUT` branches detect-changes.sh can take. */
const DETECTOR_OUTPUT_BRANCHES = 3;

/**
 * Flags that must be emitted on every one of those branches.
 *
 * <p>`deps` and `syntax_guardrails` are here because the ESLint step now
 * gates on them. An early-return branch that forgot to emit one would leave
 * the workflow output unset, and an unset output is falsy — so the step would
 * silently skip on exactly the lockfile-only bump it exists to catch.
 */
const DETECTOR_FLAGS = [
  'critical_deps',
  'full_suite',
  'public_surface',
  'deps',
  'syntax_guardrails',
] as const;

/**
 * Steps that must also fire on a lockfile-only bump, not just `full_suite`.
 *
 * <p>A lint-rule bump lands as `deps` alone: `critical_deps` covers only the
 * browser stack, so `full_suite` (`src OR critical_deps`) stays false and a
 * step gated on `full_suite` never runs. `typescript-eslint` 8.70.0 reached
 * main exactly that way — it added `no-generated-empty-object-type`, which
 * fires on existing `src/` code, so the FIRST unrelated PR afterwards failed
 * lint while the bump itself merged green.
 */
const DEPS_GATED_STEP_NAMES = [
  'Audit production dependencies',
  'Audit all dependencies (informational)',
  'ESLint (warnings as errors)',
] as const;

/**
 * Steps that must ALSO fire when only the lint configuration changes.
 *
 * <p>`syntax_guardrails` is the flag a PR touching `eslint.config.mjs` alone
 * sets — it sets neither `src`, `deps` nor `full_suite`. A rule tightened by
 * hand is the same hazard as one arriving via dependabot, so the run that
 * changes the rules must be the run that proves them.
 */
const CONFIG_GATED_STEP_NAMES = ['ESLint (warnings as errors)'] as const;

/** Every step above, deduplicated — `ESLint` belongs to both sets. */
const GATED_STEP_NAMES = [...DEPS_GATED_STEP_NAMES, ...CONFIG_GATED_STEP_NAMES];

/**
 * Steps whose flags must be OR-ed, never AND-ed.
 *
 * <p>`full_suite == 'true' && deps == 'true'` satisfies every membership
 * assertion above and still skips the step on the deps-only bump those
 * assertions exist to catch. The operator is the invariant, so it is pinned
 * separately from the flag names.
 */
const OR_ONLY_STEP_NAMES = [...new Set(GATED_STEP_NAMES)];

/**
 * Every file that can change what ESLint enforces.
 *
 * <p>All four must set `syntax_guardrails`, or a PR can rewrite the rules
 * without ever running them against `src`. `eslint.canary-scope.mjs` is the
 * non-obvious one: `eslint.config.mjs` imports it directly and it decides
 * which files the guard even sees, so editing it alone used to set no flag
 * at all — neither `src`, nor `deps`, nor `syntax_guardrails`.
 */
const LINT_CONFIG_INPUTS = [
  String.raw`^eslint\.config\.mjs$`,
  String.raw`^eslint\.canary-scope\.mjs$`,
  String.raw`^scripts/check-syntax-guardrails\.mjs$`,
  String.raw`^package\.json$`,
  String.raw`^tsconfig\.json$`,
] as const;

/**
 * Pull the alternatives out of the detector's `syntax_guardrails` test.
 *
 * <p>Asserting each pattern is merely *present* is a one-way ratchet: it
 * catches a removal but not an addition, so a new lint input could be wired
 * in without anyone revisiting which flag it should arm. Comparing the whole
 * alternation makes the set exact in both directions.
 * @param script - Raw text of detect-changes.sh.
 * @returns Every alternative in the guard expression, in source order.
 */
function syntaxGuardrailInputs(script: string): readonly string[] {
  const line = /if has '([^']+)'; then\r?\n[ \t]*syntax_guardrails=true/u.exec(script);
  if (line === null) return [];
  return line[1].split('|');
}

interface IPrYamlStep {
  readonly name?: string;
  readonly if?: unknown;
}

interface IPrYamlJob {
  readonly if?: unknown;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly steps?: readonly IPrYamlStep[];
}

interface IPrYamlDoc {
  readonly jobs?: Readonly<Record<string, IPrYamlJob>>;
}

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
 * Parse the PR workflow.
 *
 * @returns Parsed workflow document.
 */
function loadPrYaml(): IPrYamlDoc {
  const raw = read(PR_YAML);
  return parse(raw) as IPrYamlDoc;
}

/**
 * Find every job registered under a YAML key.
 *
 * @param key - YAML job key under `jobs:`.
 * @returns Zero or one matching job definition.
 */
function findJob(key: string): readonly IPrYamlJob[] {
  const doc = loadPrYaml();
  const jobs = doc.jobs ?? {};
  const entries = Object.entries(jobs);
  const matched = entries.filter(([name]): boolean => name === key);
  return matched.map(([, job]): IPrYamlJob => job);
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
 * List the output names a job exposes to downstream `needs.*` lookups.
 *
 * @param key - YAML job key under `jobs:`.
 * @returns Declared output names, empty when the job declares none.
 */
function jobOutputKeys(key: string): readonly string[] {
  const matched = findJob(key);
  return matched.flatMap((job): string[] => Object.keys(job.outputs ?? {}));
}

/**
 * Resolve the `if:` conditions of every identically named step in a job.
 *
 * @param jobKey - YAML job key under `jobs:`.
 * @param stepName - Exact `name:` of the step to match.
 * @returns One condition string per matching step.
 */
function stepConditions(jobKey: string, stepName: string): readonly string[] {
  const matched = findJob(jobKey);
  const steps = matched.flatMap((job): IPrYamlStep[] => [...(job.steps ?? [])]);
  const named = steps.filter((step): boolean => step.name === stepName);
  return named.map((step): string => (typeof step.if === 'string' ? step.if : ''));
}

/**
 * Count non-overlapping occurrences of a literal needle.
 *
 * @param haystack - Text to scan.
 * @param needle - Literal substring to count.
 * @returns Number of occurrences.
 */
function countOf(haystack: string, needle: string): number {
  const segments = haystack.split(needle);
  return segments.length - 1;
}

describe('CriticalDepsFullSuiteGate', () => {
  it.each(HEAVY_JOB_KEYS)('[CI-CRIT-GATE] PrYaml_HeavyJob_%s_ShouldGateOnFullSuite', jobKey => {
    const condition = jobCondition(jobKey);
    expect(condition).not.toBe('');
    expect(condition).toContain("full_suite == 'true'");
  });

  it.each(CRITICAL_PACKAGES)('[CI-CRIT-GATE] Detector_Package_%s_ShouldStayDeclared', pkg => {
    const rawManifest = read(PACKAGE_JSON);
    const manifest = JSON.parse(rawManifest) as { dependencies?: Record<string, string> };
    const declared = manifest.dependencies ?? {};
    const script = read(DETECTOR);
    expect(declared[pkg]).toBeDefined();
    expect(script).toContain(`'${pkg}'`);
  });

  it.each(DETECTOR_FLAGS)('[CI-CRIT-GATE] Detector_Output_%s_ShouldCoverEveryBranch', flag => {
    const script = read(DETECTOR);
    const emitted = countOf(script, `echo "${flag}=`);
    expect(emitted).toBe(DETECTOR_OUTPUT_BRANCHES);
  });

  it('[CI-CRIT-GATE] Detector_PatchAndBrowserPinPaths_ShouldFeedCriticalDeps', () => {
    const script = read(DETECTOR);
    expect(script).toContain('^scripts/patch-playwright-core\\.mjs');
    expect(script).toContain('.github/actions/install-camoufox/');
  });

  it('[CI-CRIT-GATE] Detector_FullSuite_ShouldBeSrcOrCriticalDeps', () => {
    const script = read(DETECTOR);
    expect(script).toContain(
      'if [ "${src}" = "true" ] || [ "${critical_deps}" = "true" ]; then full_suite=true; fi',
    );
  });

  it('[CI-CRIT-GATE] PrYaml_LintAndTypes_ShouldGateOnFullSuiteNotSrc', () => {
    const condition = jobCondition('lint-and-types');
    expect(condition).toContain("full_suite == 'true'");
    expect(condition).not.toContain("outputs.src == 'true'");
  });

  it.each(DEPS_GATED_STEP_NAMES)(
    '[CI-CRIT-GATE] PrYaml_Step_%s_ShouldCoverDepsOnlyBumps',
    stepName => {
      const conditions = stepConditions('lint-and-types', stepName);
      expect(conditions).toHaveLength(1);
      const condition = conditions.join('');
      expect(condition).toContain("needs.changes.outputs.full_suite == 'true'");
      expect(condition).toContain("needs.changes.outputs.deps == 'true'");
    },
  );

  it.each(CONFIG_GATED_STEP_NAMES)(
    '[CI-CRIT-GATE] PrYaml_Step_%s_ShouldCoverConfigOnlyEdits',
    stepName => {
      const conditions = stepConditions('lint-and-types', stepName);
      expect(conditions).toHaveLength(1);
      const condition = conditions.join('');
      expect(condition).toContain("needs.changes.outputs.syntax_guardrails == 'true'");
    },
  );

  it.each(OR_ONLY_STEP_NAMES)(
    '[CI-CRIT-GATE] PrYaml_Step_%s_ShouldCombineFlagsWithOr',
    stepName => {
      const conditions = stepConditions('lint-and-types', stepName);
      const condition = conditions.join('');
      expect(condition).toContain('||');
      expect(condition).not.toContain('&&');
    },
  );

  it('[CI-CRIT-GATE] Detector_LintConfigInputs_ShouldMatchTheContractExactly', () => {
    const detector = read(DETECTOR);
    const found = syntaxGuardrailInputs(detector);
    expect(found).toStrictEqual([...LINT_CONFIG_INPUTS]);
  });

  it('[CI-CRIT-GATE] GateScript_RealGates_ShouldConsumeFullSuite', () => {
    const script = read(GATE_SCRIPT);
    const workflow = read(PR_YAML);
    expect(script).toContain('$FULL_SUITE');
    expect(script).not.toContain('SRC_TOUCHED');
    expect(workflow).toContain('FULL_SUITE: ${{ steps.changes.outputs.full_suite }}');
  });

  it('[CI-CRIT-GATE] PrYaml_ChangesAndValidate_ShouldExposeFullSuiteOutput', () => {
    const changesOutputs = jobOutputKeys('changes');
    const validateOutputs = jobOutputKeys('validate');
    expect(changesOutputs).toContain('full_suite');
    expect(changesOutputs).toContain('critical_deps');
    expect(validateOutputs).toContain('full_suite');
  });

  it('[CI-CRIT-GATE] PrYaml_Build_ShouldAlsoGateOnPublicSurface', () => {
    const changesOutputs = jobOutputKeys('changes');
    const condition = jobCondition('build');
    expect(changesOutputs).toContain('public_surface');
    expect(condition).toContain("public_surface == 'true'");
  });

  it.each(PUBLIC_SURFACE_PATHS)(
    '[CI-CRIT-GATE] Detector_PublicSurfacePath_%s_ShouldFeedPublicSurface',
    pattern => {
      const script = read(DETECTOR);
      expect(script).toContain(pattern);
    },
  );

  it('[CI-CRIT-GATE] PrYaml_Build_ShouldUnionNotIntersectTheFlags', () => {
    const condition = jobCondition('build');
    const isConjunction = condition.includes('&&');
    expect(condition).toContain('||');
    expect(isConjunction).toBe(false);
  });

  it('[CI-CRIT-GATE] Detector_UnknownState_ShouldFailOpenNotClosed', () => {
    const script = read(DETECTOR);
    const failOpenReferences = countOf(script, 'emit_fail_open');
    expect(script).toContain('echo "public_surface=true"');
    expect(script).toContain('echo "public_surface=false"');
    expect(script).toContain('--no-renames');
    expect(failOpenReferences).toBeGreaterThanOrEqual(3);
  });

  it.each(CHECKER_CALL_SITES)(
    '[CI-CRIT-GATE] Wiring_%s_ShouldStillInvokeTheChecker',
    (relativePath, needle) => {
      const absolutePath = join(REPO_ROOT, relativePath);
      const contents = read(absolutePath);
      expect(contents).toContain(needle);
    },
  );

  it('[CI-CRIT-GATE] Wiring_PackageJson_ShouldRunCheckerInCheckMode', () => {
    const manifestSource = read(PACKAGE_JSON);
    const manifest = JSON.parse(manifestSource) as {
      scripts: Record<string, string>;
    };
    const checkScript = manifest.scripts['lint:public-surface'];
    expect(checkScript).toBe(CHECK_SCRIPT_COMMAND);
  });

  it('[CI-CRIT-GATE] Wiring_HuskyBuildGate_ShouldChainTheChecker', () => {
    const hookPath = join(REPO_ROOT, '.husky/pre-commit');
    const hook = read(hookPath);
    const buildGate = hook.split('\n').find(line => line.includes('bg_gate "build"')) ?? '';
    const hasCheckerChained = buildGate.trimEnd().endsWith("&& npm run lint:public-surface'");
    expect(hasCheckerChained).toBe(true);
  });

  it('[CI-CRIT-GATE] Detector_HuskyChange_ShouldRunTheWiringTests', () => {
    const script = read(DETECTOR);
    const ciScriptsRule =
      script.split('\n').find(line => line.includes('has') && line.includes('ci_scripts=true')) ??
      '';
    expect(ciScriptsRule).toContain('husky');
  });
});
