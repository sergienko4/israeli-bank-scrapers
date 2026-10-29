/**
 * Type declarations for `scripts/dev-tooling/tooling-group.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that import it need this to type it rather than import `any`.
 */

/** The group the watch probes. */
export const TOOLING_GROUP: 'lint-tooling';

/**
 * Whether a Dependabot pattern names a package.
 *
 * @param pattern - The pattern; `*` matches any run of characters.
 * @param name - The package name.
 * @returns True when the pattern matches the whole name.
 */
export function matchesPattern(pattern: string, name: string): boolean;

/**
 * The patterns of the `lint-tooling` group on the root npm entry.
 *
 * @param dependabotYaml - The text of `.github/dependabot.yml`.
 * @returns Its patterns; empty when the group or entry is missing.
 */
export function toolingPatterns(dependabotYaml: string): string[];

/**
 * The names some pattern matches.
 *
 * @param names - Package names.
 * @param patterns - Dependabot patterns.
 * @returns The matching names, in order.
 */
export function matchingPackages(names: readonly string[], patterns: readonly string[]): string[];
