/**
 * The `lint-tooling` Dependabot group: which packages it takes.
 *
 * Shared by the dev-tooling watch, which probes those packages, and the
 * grouping test, which checks the group takes every lint package. Both read
 * a Dependabot pattern the same way: `*` matches any run of characters and
 * the pattern must match the whole name.
 */
import { parse } from 'yaml';

/** The group the watch probes. */
export const TOOLING_GROUP = 'lint-tooling';

/** Characters a pattern must not pass to a RegExp unescaped. */
const REGEXP_SPECIAL = /[$()+./?[\\\]^{|}]/g;

/**
 * Whether a Dependabot pattern names a package.
 *
 * @param {string} pattern - The pattern; `*` matches any run of characters.
 * @param {string} name - The package name.
 * @returns {boolean} True when the pattern matches the whole name.
 */
export function matchesPattern(pattern, name) {
  const parts = pattern.split('*').map(part => part.replaceAll(REGEXP_SPECIAL, String.raw`\$&`));
  return new RegExp(`^${parts.join('.*')}$`, 'u').test(name);
}

/**
 * The patterns of the `lint-tooling` group on the root npm entry.
 *
 * @param {string} dependabotYaml - The text of `.github/dependabot.yml`.
 * @returns {string[]} Its patterns; empty when the group or entry is missing.
 */
export function toolingPatterns(dependabotYaml) {
  const doc =
    /** @type {{ updates?: { 'package-ecosystem'?: string, directory?: string, groups?: Record<string, { patterns?: string[] }> }[] }} */ (
      parse(dependabotYaml) ?? {}
    );
  const npm = (doc.updates ?? []).find(
    u => u['package-ecosystem'] === 'npm' && u.directory === '/',
  );
  return [...(npm?.groups?.[TOOLING_GROUP]?.patterns ?? [])];
}

/**
 * The names some pattern matches.
 *
 * @param {readonly string[]} names - Package names.
 * @param {readonly string[]} patterns - Dependabot patterns.
 * @returns {string[]} The matching names, in order.
 */
export function matchingPackages(names, patterns) {
  return names.filter(name => patterns.some(pattern => matchesPattern(pattern, name)));
}
