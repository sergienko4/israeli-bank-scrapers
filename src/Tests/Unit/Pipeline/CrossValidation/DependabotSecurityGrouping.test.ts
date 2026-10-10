/**
 * Dependabot npm security-grouping wiring test.
 *
 * <p>For npm, Dependabot targets a transitive (lockfile-only) dependency on
 * exactly one path: a security update, raised while the matching Dependabot
 * alert is open. Version updates target only the manifest's direct
 * dependencies, and npm has no `dependency-type: indirect` to widen them.
 *
 * <p>The `npm-security` group pins that path to one grouped pull request per
 * run, so several open advisories land together instead of as a burst of
 * single-package PRs. It is a policy guard, not runtime proof: whether
 * Dependabot actually opens the PR also depends on the repository's
 * auto-triage rules, which live outside this file (see
 * `docs/workflow/code-scanning.md`, "Standing finding 4").
 *
 * <p>Two silent regressions are pinned here:
 *
 * <ul>
 *   <li>Deleting, renaming, or narrowing the group (`exclude-patterns`,
 *       `dependency-type`, `update-types`) falls back to the UI toggle or
 *       drops packages or updates, and nothing in the repository records
 *       it.</li>
 *   <li>Scoping a version group to security updates, or adding a second
 *       security group, changes which group claims a package. Dependabot
 *       assigns each dependency to the first group it matches. An absent
 *       `applies-to` and an explicit `version-updates` are equivalent:
 *       Dependabot defaults the key to version updates. A key that is
 *       present but empty or null is not a valid scope, so it is flagged
 *       rather than defaulted.</li>
 * </ul>
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const DEPENDABOT_YAML = join(REPO_ROOT, '.github/dependabot.yml');

/** Group name cited by `.github/dependabot.yml` and the code-scanning doc. */
const SECURITY_GROUP_NAME = 'npm-security';

/** `applies-to` value scoping a group to security updates. */
const SECURITY_UPDATES = 'security-updates';

/** `applies-to` value Dependabot assumes when the key is absent. */
const VERSION_UPDATES = 'version-updates';

/** Group key that scopes a group to version or security updates. */
const APPLIES_TO_KEY = 'applies-to';

/** Pattern matching every package in the ecosystem. */
const ALL_PACKAGES = '*';

/** Expected number of npm security groups: one group for every advisory. */
const SECURITY_GROUP_COUNT = 1;

/** Group keys that shrink the set of packages or updates a group matches. */
const NARROWING_KEYS = ['exclude-patterns', 'dependency-type', 'update-types'] as const;

interface IDependabotGroup {
  /** YAML parses an empty `applies-to:` value as null, not as absent. */
  readonly 'applies-to'?: string | null;
  readonly patterns?: readonly string[];
  readonly 'exclude-patterns'?: readonly string[];
  readonly 'dependency-type'?: string;
  readonly 'update-types'?: readonly string[];
}

interface IDependabotUpdate {
  readonly 'package-ecosystem': string;
  readonly directory: string;
  readonly groups?: Readonly<Record<string, IDependabotGroup>>;
}

interface IDependabotDoc {
  readonly updates?: readonly IDependabotUpdate[];
}

interface IScopeCase {
  readonly name: string;
  readonly yaml: string;
  readonly isVersion: boolean;
}

/** Group snippets pinning how each `applies-to` shape is classified. */
const SCOPE_CASES: readonly IScopeCase[] = [
  { name: 'an absent key', yaml: "patterns: ['*']", isVersion: true },
  { name: 'explicit version-updates', yaml: 'applies-to: version-updates', isVersion: true },
  { name: 'explicit security-updates', yaml: 'applies-to: security-updates', isVersion: false },
  { name: 'an empty value', yaml: 'applies-to:', isVersion: false },
  { name: 'an explicit null', yaml: 'applies-to: null', isVersion: false },
  { name: 'an empty string', yaml: "applies-to: ''", isVersion: false },
];

/**
 * Parse the Dependabot configuration.
 *
 * @returns Parsed document, or an empty document when the file is absent.
 */
function loadDependabot(): IDependabotDoc {
  if (!existsSync(DEPENDABOT_YAML)) {
    return {};
  }
  const raw = readFileSync(DEPENDABOT_YAML, 'utf8');
  return parse(raw) as IDependabotDoc;
}

/**
 * Groups declared on the root npm entry, keyed by group name.
 *
 * @returns Every npm group, or an empty map when the entry is missing.
 */
function npmGroupMap(): Readonly<Record<string, IDependabotGroup>> {
  const updates = loadDependabot().updates ?? [];
  const npm = updates.find(item => item['package-ecosystem'] === 'npm' && item.directory === '/');
  return npm?.groups ?? {};
}

/**
 * Groups declared on the root npm entry.
 *
 * @returns Every npm group, or an empty list when the entry is missing.
 */
function npmGroups(): readonly IDependabotGroup[] {
  const groups = npmGroupMap();
  return Object.values(groups);
}

/**
 * Whether a group is scoped to security updates.
 *
 * @param group - Group to classify.
 * @returns True when the group applies to security updates.
 */
function isSecurityGroup(group: IDependabotGroup): boolean {
  return group['applies-to'] === SECURITY_UPDATES;
}

/**
 * Whether a group is scoped to version updates, explicitly or by default.
 *
 * <p>Only a missing key takes Dependabot's default. A present key whose
 * value is empty or null is malformed, so it is not a version group.
 *
 * @param group - Group to classify.
 * @returns True when `applies-to` is absent or set to version updates.
 */
function isVersionGroup(group: IDependabotGroup): boolean {
  if (!Object.hasOwn(group, APPLIES_TO_KEY)) {
    return true;
  }
  return group[APPLIES_TO_KEY] === VERSION_UPDATES;
}

/**
 * Whether a group sets any key that shrinks its package or update set.
 *
 * @param group - Group to inspect.
 * @returns True when a narrowing key is present.
 */
function isNarrowed(group: IDependabotGroup): boolean {
  return NARROWING_KEYS.some(key => group[key] !== undefined);
}

describe('Dependabot npm security grouping', () => {
  it('[DSG-1] groups security updates for every npm package', () => {
    const groups = npmGroupMap();
    expect(groups).toHaveProperty(SECURITY_GROUP_NAME);
    const group = groups[SECURITY_GROUP_NAME];
    expect(group['applies-to']).toBe(SECURITY_UPDATES);
    expect(group.patterns).toContain(ALL_PACKAGES);
  });

  it('[DSG-2] keeps every other npm group on version updates', () => {
    const others = npmGroups().filter(group => !isSecurityGroup(group));
    const scoped = others.filter(group => !isVersionGroup(group));
    expect(others.length).toBeGreaterThan(0);
    expect(scoped).toEqual([]);
  });

  it('[DSG-3] declares exactly one npm security group', () => {
    const security = npmGroups().filter(isSecurityGroup);
    expect(security).toHaveLength(SECURITY_GROUP_COUNT);
  });

  it('[DSG-4] leaves the security group un-narrowed', () => {
    const security = npmGroups().filter(isSecurityGroup);
    const narrowed = security.filter(isNarrowed);
    expect(security.length).toBeGreaterThan(0);
    expect(narrowed).toEqual([]);
  });

  it.each(SCOPE_CASES)('[DSG-5] $name is a version group: $isVersion', row => {
    const group = parse(row.yaml) as IDependabotGroup;
    const isVersion = isVersionGroup(group);
    expect(isVersion).toBe(row.isVersion);
  });
});
