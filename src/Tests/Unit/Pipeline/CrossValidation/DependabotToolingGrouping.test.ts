/**
 * Dependabot lint-tooling grouping wiring test.
 *
 * <p>A minor release of a lint or format package can add or tighten a rule.
 * typescript-eslint 8.72 extended `no-deprecated` to object-literal
 * properties, so the weekly `dev-dependencies` pull request (#673) went red,
 * and every inert bump in it waited for a code fix. The `lint-tooling` group
 * gives those packages a pull request of their own, so the other dev bumps
 * go green without them.
 *
 * <p>The oracle is the repository, not the group's patterns: every dev
 * dependency `eslint.config.mjs` imports, plus the three runners, ESLint,
 * Prettier and Biome. Each must belong to `lint-tooling` and to no other
 * version-update group. Dependabot gives a package to the first group it
 * matches, so excluding it everywhere else keeps the split independent of
 * group order.
 */

import type { IDependabotGroup } from '../../../Helpers/DependabotConfig.js';
import { npmGroupMap } from '../../../Helpers/DependabotConfig.js';
import { readRepoFile } from '../../../Helpers/RepoFiles.js';

/** Group name cited by `.github/dependabot.yml` and the dependency-updates doc. */
const TOOLING_GROUP = 'lint-tooling';

/** Update types the group takes; a major still gets a pull request of its own. */
const TOOLING_UPDATE_TYPES = ['minor', 'patch'];

/** Group key that scopes a group to version or security updates. */
const APPLIES_TO_KEY = 'applies-to';

/** `applies-to` value of a group that takes no version update. */
const SECURITY_UPDATES = 'security-updates';

/** `dependency-type` of a group that never takes a dev dependency. */
const PRODUCTION = 'production';

/** The packages that run the lint and format gates. */
const RUNNERS = ['eslint', 'prettier', '@biomejs/biome'];

/** The package behind #673, the bump this group exists for. */
const TYPESCRIPT_ESLINT = 'typescript-eslint';

/** A package import in `eslint.config.mjs`; relative imports start with `.`. */
const PACKAGE_IMPORT = /^import .+ from '(?<specifier>[^'.][^']*)';$/gm;

/** Characters a Dependabot pattern must not pass to a RegExp unescaped. */
const REGEXP_SPECIAL = /[$()+./?[\\\]^{|}]/g;

interface IPackageJson {
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * The packages `eslint.config.mjs` imports.
 *
 * @returns Their specifiers, in order.
 */
function eslintConfigImports(): readonly string[] {
  const config = readRepoFile('eslint.config.mjs');
  const imports = config.matchAll(PACKAGE_IMPORT);
  return Array.from(imports, match => match.groups?.specifier ?? '');
}

/**
 * The dev dependencies that decide what the lint and format gates report.
 *
 * @returns Their names, in `package.json` order.
 */
function toolingPackages(): readonly string[] {
  const manifest = readRepoFile('package.json');
  const devDependencies = (JSON.parse(manifest) as IPackageJson).devDependencies ?? {};
  const imports = eslintConfigImports();
  const wanted = [...RUNNERS, ...imports];
  const names = Object.keys(devDependencies);
  return names.filter(name => wanted.includes(name));
}

/**
 * Whether a Dependabot pattern, where `*` matches any run of characters,
 * names a package.
 *
 * @param pattern - The pattern.
 * @param name - The package name.
 * @returns True when the pattern matches the whole name.
 */
function matchesPattern(pattern: string, name: string): boolean {
  const parts = pattern.split('*');
  const escaped = parts.map(part => part.replaceAll(REGEXP_SPECIAL, String.raw`\$&`));
  const source = escaped.join('.*');
  return new RegExp(`^${source}$`, 'u').test(name);
}

/**
 * Whether a version-update group takes a dev dependency.
 *
 * @param group - The group.
 * @param name - The dev dependency.
 * @returns True when its patterns include the package and none excludes it.
 */
function takes(group: IDependabotGroup, name: string): boolean {
  const isIncluded = group.patterns?.some(pattern => matchesPattern(pattern, name)) ?? true;
  const excludes = group['exclude-patterns'] ?? [];
  const isExcluded = excludes.some(pattern => matchesPattern(pattern, name));
  return isIncluded && !isExcluded && group['dependency-type'] !== PRODUCTION;
}

/**
 * The version-update groups other than `lint-tooling` that take a package.
 *
 * @param name - The package.
 * @returns Their names.
 */
function otherGroupsTaking(name: string): readonly string[] {
  const groups = npmGroupMap();
  const entries = Object.entries(groups);
  const others = entries.filter(([key]) => key !== TOOLING_GROUP);
  const versionGroups = others.filter(([, group]) => group[APPLIES_TO_KEY] !== SECURITY_UPDATES);
  return versionGroups.filter(([, group]) => takes(group, name)).map(([key]) => key);
}

/** The lint and format packages, from the repository itself. */
const TOOLING = toolingPackages();

describe('Dependabot lint-tooling grouping', () => {
  it('[DTG-1] groups minor and patch version updates of the lint tooling', () => {
    const groups = npmGroupMap();
    expect(groups).toHaveProperty(TOOLING_GROUP);
    const group = groups[TOOLING_GROUP];
    expect(group).not.toHaveProperty(APPLIES_TO_KEY);
    expect(group['update-types']).toEqual(TOOLING_UPDATE_TYPES);
  });

  it('[DTG-2] finds the lint tooling, typescript-eslint included', () => {
    expect(TOOLING).toContain(TYPESCRIPT_ESLINT);
    expect(TOOLING.length).toBeGreaterThan(RUNNERS.length);
  });

  it.each(TOOLING)('[DTG-3] %s belongs to lint-tooling', name => {
    const group = npmGroupMap()[TOOLING_GROUP];
    const isTaken = takes(group, name);
    expect(isTaken).toBe(true);
  });

  it.each(TOOLING)('[DTG-4] %s belongs to no other version-update group', name => {
    const others = otherGroupsTaking(name);
    expect(others).toEqual([]);
  });
});
