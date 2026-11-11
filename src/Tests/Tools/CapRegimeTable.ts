/**
 * CAP REGIME TABLE — the cap expectation that lives OUTSIDE `eslint.config.mjs`.
 *
 * <p>Flat ESLint config is ordered (last-wins), so a later block that loosens or
 * disables a rule silently overrides earlier strict declarations. No check
 * derived only from `eslint.config.mjs` can catch that, because the expectation
 * disappears or shifts together with the config edit. Restating the canonical
 * expectation here, independently, lets the gate assert exact agreement for
 * every production file.
 *
 * <p>All production trees now resolve directly to {@link CANONICAL_CAPS} with
 * an empty `CapOverrides.ts` table. Any reviewed per-path deviation added in
 * `CapOverrides.ts` uses longest-prefix matching and must match ESLint's
 * resolved value in both directions — looser is a regression, tighter means the
 * override entry is stale and should be removed.
 */

/** Canonical caps from CLEAN_CODE.md — the default for every production tree. */
export const CANONICAL_CAPS: Readonly<Record<string, number>> = {
  'max-lines': 150,
  'max-lines-per-function': 10,
  complexity: 10,
  '@typescript-eslint/max-params': 3,
};

/**
 * Production roots the regime audit walks.
 *
 * Canaries are excluded because they hold deliberate violations. Top-level
 * `src/*.ts` is left to the §3 cluster row, whose representative is `src/index.ts`.
 */
export const PRODUCTION_ROOTS: readonly string[] = ['src/Common', 'src/Scrapers'];

/** Directory name that holds deliberate rule violations, so it is never audited. */
export const CANARY_DIR = 'EslintCanaries';

/**
 * Directory names that carry a non-production cap regime, so they are skipped.
 *
 * `eslint.config.mjs:900` relaxes `max-lines-per-function` to `off` and
 * `max-lines` to 600 for `**\/mocks/**\/*.ts`. Such a directory is not
 * production code, so auditing it against the production table would be wrong.
 */
export const NON_PRODUCTION_DIRS: readonly string[] = [CANARY_DIR, 'mocks'];

/**
 * File suffixes that carry a non-production cap regime, so they are skipped.
 *
 * The same `eslint.config.mjs:900` block relaxes those two caps for
 * `src/**\/*.test.ts` and `src/**\/*.spec.ts`. No such file exists under
 * {@link PRODUCTION_ROOTS} today, so this is a guard against a future one
 * being audited against the production table it does not belong to.
 *
 * `.d.ts` is deliberately NOT listed. ESLint applies the production caps to
 * declaration files like any other source, and `max-lines` binds even without
 * function bodies, so excluding them would leave an unaudited category.
 */
export const NON_PRODUCTION_SUFFIXES: readonly string[] = ['.test.ts', '.spec.ts'];
