/**
 * Jest project partition — what the unit and policy projects select together.
 *
 * `test:unit` and `test:policy` are two Jest projects that split the tracked
 * tests between them. `scripts/check-jest-scopes.mjs` stops a script reaching
 * past the gated run; it does not prove the two projects still cover every
 * test, or that they still transform and resolve alike. A test moved between
 * directories, or a pattern widened in one config, could drop a suite from both
 * runs while every other gate stays green.
 *
 * Expected completeness comes from `git ls-files` and the reviewed exclusions
 * declared below, never from the configs under test, so an omission shared by
 * both configs cannot pass. Jest itself resolves selections and settings
 * (`--listTests`, `--showConfig`); no selection pattern is re-implemented here.
 * Tracked files only: a local scratch test is not a CI coverage problem.
 *
 * Rules:
 *   JPP-1  no suite is selected by both projects
 *   JPP-2  every tracked test is selected, except the reviewed exclusions
 *   JPP-3  no reviewed exclusion is selected, and each still matches a file
 *   JPP-4  the projects differ only in their selection and coverage settings
 *   JPP-5  both projects pin the same time zone
 */
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import { trackedFiles } from '../../Helpers/RepoFiles.js';

/** One project's resolved settings, as `jest --showConfig` prints them. */
interface IShownConfig {
  readonly configs: readonly JsonUnknownRecord[];
  readonly globalConfig: JsonUnknownRecord;
}

/** The tracked tests and what each project selects. */
interface ISelections {
  readonly tracked: readonly string[];
  readonly unit: readonly string[];
  readonly policy: readonly string[];
}

/** Everything the oracle compares, read once from the repo and Jest. */
interface ISnapshot extends ISelections {
  readonly shown: { readonly unit: IShownConfig; readonly policy: IShownConfig };
  readonly zones: { readonly unit: string; readonly policy: string };
}

const ROOT = process.cwd();
const JEST_ENTRY = 'node_modules/jest/bin/jest.js';
const UNIT_CONFIG = 'jest.unit.config.js';
const POLICY_CONFIG = 'jest.policy.config.cjs';
const CHILD_BUFFER = 64 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 120_000;
const ZONE_PROBE = 'await import(process.argv[1]); process.stdout.write(process.env.TZ ?? "");';

/** What a developer calls a test: a spec file anywhere under `src/`. */
const TEST_FILE = /^src\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Suites no unattended project may select. Declared here, not derived from the
 * configs, so widening a config cannot also widen what counts as complete.
 */
const REVIEWED_EXCLUSIONS = [
  { prefix: 'src/Tests/E2eReal/', why: 'drives a live bank with real credentials' },
  { prefix: 'src/Tests/E2eMocked/', why: 'slow mocked E2E with its own script and CI job' },
  { prefix: 'src/Tests/E2eFull/', why: 'full-journey E2E with its own script' },
  { prefix: 'src/Tests/E2e.test.ts', why: 'live-bank factory suite with its own CI job' },
] as const;

/** Settings that legitimately differ: what each project selects, and coverage. */
const PROJECT_SPECIFIC: readonly string[] = [
  'id',
  'testMatch',
  'testPathIgnorePatterns',
  'collectCoverageFrom',
  'coveragePathIgnorePatterns',
];

/** A split that satisfies every rule; each negative oracle breaks one thing. */
const HEALTHY: ISelections = {
  tracked: [
    'src/Tests/Unit/Tools/Parser.test.ts',
    'src/Tests/Policy/WorkflowGate.test.ts',
    'src/Tests/Policy/ReleaseGate.test.ts',
    'src/Tests/E2eReal/Hapoalim.e2e-real.test.ts',
    'src/Tests/E2eMocked/Hapoalim.e2e-mocked.test.ts',
    'src/Tests/E2eFull/Journey.test.ts',
    'src/Tests/E2e.test.ts',
  ],
  unit: ['src/Tests/Unit/Tools/Parser.test.ts'],
  policy: ['src/Tests/Policy/WorkflowGate.test.ts', 'src/Tests/Policy/ReleaseGate.test.ts'],
};

/** Resolved settings two healthy projects share. */
const SHARED_SETTINGS: JsonUnknownRecord = {
  transform: [['^.+\\.ts$', 'ts-jest', { useESM: true }]],
  setupFilesAfterEnv: ['/repo/src/Tests/JestSetup.ts'],
  moduleNameMapper: [['^(\\.{1,2}/.*)\\.js$', '$1']],
  testEnvironment: 'node',
};

/**
 * Every environment variable except the named ones.
 * @param names - Variables to drop.
 * @returns The remaining environment.
 */
function envWithout(names: readonly string[]): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !names.includes(name));
  return Object.fromEntries(kept);
}

/**
 * Run a child Node process and return its stdout, failing loudly otherwise.
 * @param args - Arguments after the Node executable.
 * @param env - The child's environment.
 * @returns The child's stdout.
 */
function runChild(args: readonly string[], env: NodeJS.ProcessEnv): string {
  const options = { cwd: ROOT, env, encoding: 'utf8', maxBuffer: CHILD_BUFFER } as const;
  const run = spawnSync(process.execPath, args, { ...options, timeout: CHILD_TIMEOUT_MS });
  if (run.error !== undefined) throw run.error;
  const failure = `${args.join(' ')} exited ${String(run.status)}: ${run.stderr.slice(-300)}`;
  if (run.status !== 0) throw new RangeError(failure);
  return run.stdout;
}

/**
 * Ask Jest about one project, using the same config the npm scripts use.
 * @param config - Repo-relative Jest config path.
 * @param flags - Jest flags that print a report instead of running tests.
 * @returns Jest's stdout.
 */
function jestOutput(config: string, flags: readonly string[]): string {
  const args = ['--experimental-vm-modules', JEST_ENTRY, `--config=${config}`, ...flags];
  const env = envWithout(['JEST_WORKER_ID']);
  return runChild(args, env);
}

/**
 * Repo-relative, slash-separated form of an absolute path Jest printed.
 * @param absolute - Absolute path.
 * @returns The path relative to the repo root.
 */
function toRepoPath(absolute: string): string {
  const relativePath = relative(ROOT, absolute);
  return relativePath.split(sep).join('/');
}

/**
 * The suites a project would execute, as Jest resolves them.
 * @param config - Repo-relative Jest config path.
 * @returns Repo-relative suite paths.
 */
function selectionOf(config: string): readonly string[] {
  const out = jestOutput(config, ['--listTests', '--json']);
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']') + 1;
  const json = out.slice(start, end);
  const listed = JSON.parse(json) as string[];
  return listed.map(toRepoPath);
}

/**
 * A project's resolved settings, as Jest prints them.
 * @param config - Repo-relative Jest config path.
 * @returns The parsed `--showConfig` report.
 */
function shownOf(config: string): IShownConfig {
  const out = jestOutput(config, ['--showConfig']);
  return JSON.parse(out) as IShownConfig;
}

/**
 * The time zone a config leaves in the environment once it has been loaded.
 * @param config - Repo-relative Jest config path.
 * @returns The zone, or an empty string when the config sets none.
 */
function timeZoneOf(config: string): string {
  const configPath = join(ROOT, config);
  const target = pathToFileURL(configPath).href;
  const args = ['--input-type=module', '-e', ZONE_PROBE, target];
  const env = envWithout(['TZ']);
  return runChild(args, env);
}

/**
 * Whether a tracked path is one of the reviewed live or serial suites.
 * @param file - Repo-relative path.
 * @returns True when a reviewed exclusion covers it.
 */
function isReviewed(file: string): boolean {
  return REVIEWED_EXCLUSIONS.some(rule => file.startsWith(rule.prefix));
}

/**
 * Suites both projects would run.
 * @param input - Tracked tests and each project's selection.
 * @returns One `overlap: <file>` line per shared suite.
 */
function overlaps(input: ISelections): string[] {
  const shared = input.unit.filter(file => input.policy.includes(file));
  return shared.map(file => `overlap: ${file}`);
}

/**
 * Tracked tests that neither project selects and no exclusion covers.
 * @param input - Tracked tests and each project's selection.
 * @returns One `unselected: <file>` line per dropped suite.
 */
function unselected(input: ISelections): string[] {
  const selected = new Set([...input.unit, ...input.policy]);
  const dropped = input.tracked.filter(file => !isReviewed(file) && !selected.has(file));
  return dropped.map(file => `unselected: ${file}`);
}

/**
 * Reviewed exclusions that a project selects anyway.
 * @param input - Tracked tests and each project's selection.
 * @returns One `leaked: <file>` line per excluded suite that is selected.
 */
function leaks(input: ISelections): string[] {
  const selected = new Set([...input.unit, ...input.policy]);
  const leaked = input.tracked.filter(file => isReviewed(file) && selected.has(file));
  return leaked.map(file => `leaked: ${file}`);
}

/**
 * Reviewed exclusions that no longer match any tracked file.
 * @param input - Tracked tests and each project's selection.
 * @returns One `stale-exclusion: <prefix>` line per dead exclusion.
 */
function staleExclusions(input: ISelections): string[] {
  const stale = REVIEWED_EXCLUSIONS.filter(
    rule => !input.tracked.some(f => f.startsWith(rule.prefix)),
  );
  return stale.map(rule => `stale-exclusion: ${rule.prefix}`);
}

/**
 * Every way the two selections disagree with the tracked inventory.
 * @param input - Tracked tests and each project's selection.
 * @returns One `kind: subject` line per disagreement; empty when they agree.
 */
function partitionFindings(input: ISelections): string[] {
  const checks = [overlaps, unselected, leaks, staleExclusions];
  return checks.flatMap(check => check(input));
}

/**
 * Resolved project settings that differ although they should be shared.
 * @param unit - The unit project's resolved settings.
 * @param policy - The policy project's resolved settings.
 * @returns Sorted names of every drifted shared setting.
 */
function driftedKeys(unit: JsonUnknownRecord, policy: JsonUnknownRecord): string[] {
  const names = new Set([...Object.keys(unit), ...Object.keys(policy)]);
  const shared = [...names].filter(name => !PROJECT_SPECIFIC.includes(name));
  const drifted = shared.filter(name => !isDeepStrictEqual(unit[name], policy[name]));
  return drifted.sort();
}

/**
 * Findings of one kind.
 * @param findings - Lines from {@link partitionFindings}.
 * @param kind - The finding kind, such as `overlap`.
 * @returns The matching lines.
 */
function ofKind(findings: readonly string[], kind: string): string[] {
  return findings.filter(line => line.startsWith(`${kind}:`));
}

/**
 * Read the repo and Jest once.
 * @returns The immutable facts every real-repository assertion uses.
 */
function takeSnapshot(): ISnapshot {
  const tracked = trackedFiles().filter(file => TEST_FILE.test(file));
  const shown = { unit: shownOf(UNIT_CONFIG), policy: shownOf(POLICY_CONFIG) };
  const zones = { unit: timeZoneOf(UNIT_CONFIG), policy: timeZoneOf(POLICY_CONFIG) };
  const unit = selectionOf(UNIT_CONFIG);
  return { tracked, unit, policy: selectionOf(POLICY_CONFIG), shown, zones };
}

describe('Jest project partition', () => {
  let snap: ISnapshot;

  beforeAll(() => {
    snap = takeSnapshot();
  });

  describe('real repository', () => {
    it('[JPP-0] each project selects suites from its own side of the split', () => {
      const hasPolicySuite = snap.unit.some(file => file.startsWith('src/Tests/Policy/'));
      const isAllPolicy = snap.policy.every(file => file.startsWith('src/Tests/Policy/'));
      expect(snap.unit).toContain('src/Tests/Unit/Tools/JestProjectPartition.test.ts');
      expect(hasPolicySuite).toBe(false);
      expect(snap.policy.length).toBeGreaterThan(0);
      expect(isAllPolicy).toBe(true);
    });

    it('[JPP-1] no suite is selected by both projects', () => {
      const findings = partitionFindings(snap);
      const overlapping = ofKind(findings, 'overlap');
      expect(overlapping).toEqual([]);
    });

    it('[JPP-2] every tracked test outside the reviewed exclusions is selected', () => {
      const findings = partitionFindings(snap);
      const dropped = ofKind(findings, 'unselected');
      expect(dropped).toEqual([]);
    });

    it('[JPP-3] no reviewed exclusion is selected and each still matches a file', () => {
      const findings = partitionFindings(snap);
      const leaked = ofKind(findings, 'leaked');
      const stale = ofKind(findings, 'stale-exclusion');
      expect(leaked).toEqual([]);
      expect(stale).toEqual([]);
    });

    it('[JPP-4] the projects differ only in selection and coverage settings', () => {
      const unit = snap.shown.unit;
      const policy = snap.shown.policy;
      const drifted = driftedKeys(unit.configs[0], policy.configs[0]);
      expect(drifted).toEqual([]);
      expect(policy.globalConfig.workerIdleMemoryLimit).toBe(
        unit.globalConfig.workerIdleMemoryLimit,
      );
      expect(unit.globalConfig.workerIdleMemoryLimit).toBeGreaterThan(0);
    });

    it('[JPP-5] both projects pin the same time zone', () => {
      expect(snap.zones.unit).not.toBe('');
      expect(snap.zones.policy).toBe(snap.zones.unit);
    });
  });

  describe('negative oracles: each defect fails for its own reason', () => {
    it('[JPP-N0] the healthy fixture has no findings', () => {
      const drifted = driftedKeys(SHARED_SETTINGS, SHARED_SETTINGS);
      const findings = partitionFindings(HEALTHY);
      expect(findings).toEqual([]);
      expect(drifted).toEqual([]);
    });

    it('[JPP-N1] a policy suite dropped from the selection is reported unselected', () => {
      const policy = HEALTHY.policy.filter(file => !file.endsWith('ReleaseGate.test.ts'));
      const findings = partitionFindings({ ...HEALTHY, policy });
      expect(findings).toEqual(['unselected: src/Tests/Policy/ReleaseGate.test.ts']);
    });

    it('[JPP-N2] a suite selected by both projects is reported as an overlap', () => {
      const unit = [...HEALTHY.unit, 'src/Tests/Policy/WorkflowGate.test.ts'];
      const findings = partitionFindings({ ...HEALTHY, unit });
      expect(findings).toEqual(['overlap: src/Tests/Policy/WorkflowGate.test.ts']);
    });

    it('[JPP-N3] a live suite pulled into the unit project is reported as leaked', () => {
      const unit = [...HEALTHY.unit, 'src/Tests/E2eReal/Hapoalim.e2e-real.test.ts'];
      const findings = partitionFindings({ ...HEALTHY, unit });
      expect(findings).toEqual(['leaked: src/Tests/E2eReal/Hapoalim.e2e-real.test.ts']);
    });

    it('[JPP-N4] an exclusion that matches no tracked file is reported stale', () => {
      const tracked = HEALTHY.tracked.filter(file => !file.startsWith('src/Tests/E2eFull/'));
      const findings = partitionFindings({ ...HEALTHY, tracked });
      expect(findings).toEqual(['stale-exclusion: src/Tests/E2eFull/']);
    });

    it.each(['transform', 'setupFilesAfterEnv', 'moduleNameMapper', 'testEnvironment'])(
      '[JPP-N5] a drifted shared %s setting is reported by name',
      setting => {
        const policy = { ...SHARED_SETTINGS, [setting]: null };
        const drifted = driftedKeys(SHARED_SETTINGS, policy);
        expect(drifted).toEqual([setting]);
      },
    );

    it('[JPP-N6] differing selection and coverage settings are not drift', () => {
      const unit = { ...SHARED_SETTINGS, testMatch: ['a'], collectCoverageFrom: ['x'] };
      const policy = { ...SHARED_SETTINGS, testMatch: ['b'], id: 'policy' };
      const drifted = driftedKeys(unit, policy);
      expect(drifted).toEqual([]);
    });
  });
});
