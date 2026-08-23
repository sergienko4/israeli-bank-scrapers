/**
 * CAP REGIME TABLE — the cap expectation that lives OUTSIDE `eslint.config.mjs`.
 *
 * <p>`eslint.config.mjs` repeatedly uses a grandfather-then-tighten shape: a
 * broad block relaxes a whole tree, and a LATER block pins a drained sub-tree
 * back to the canonical cap. Flat config is last-wins, so deleting a tightening
 * block does not merely lose a check — it silently relaxes shipped production
 * code.
 *
 * <p>No check derived only from the current `eslint.config.mjs` can catch that,
 * because the expectation disappears together with the deleted declaration. So
 * the expectation is restated here, independently, and the gate asserts the two
 * agree EXACTLY for every production file.
 *
 * <p>Exact equality is deliberate in both directions. A looser resolved cap is a
 * regression. A tighter one means a tree was drained without updating this
 * table, which `eslint-rules-guidlines.md` §1 requires in the same PR.
 *
 * <p>An entry in `CapOverrides.ts` is either a recursive directory prefix or an
 * exact file path, and the LONGEST match wins. That is this table's OWN policy —
 * the most specific statement about a path governs it — and is deliberately NOT
 * a model of how `eslint.config.mjs` resolves. Flat config is ordered: a LATER
 * block wins even when it is BROADER, so a broad grandfather placed after a
 * narrow tightening silently overrides it.
 *
 * <p>Because the two rules differ, an entry records the cap a maintainer has
 * REVIEWED and intends for that tree — never what a single config block appears
 * to declare, since a later block may override it. ESLint supplies the cap that
 * is actually in force, and the gate asserts the two agree.
 *
 * <p>Agreement therefore proves the config has not DRIFTED from a reviewed
 * decision. It does not prove the decision was right: if an entry is authored by
 * copying the resolved value instead of reviewing it, both sides agree and the
 * gate passes. That is exactly how the `Types/Domain` 10 → 30 relaxation stayed
 * hidden. Author entries from CLEAN_CODE.md and the config's stated rationale,
 * and treat a mismatch as the question "which side is wrong?" — not as a
 * prompt to overwrite the table. A path with no matching entry must resolve to
 * the canonical CLEAN_CODE.md cap.
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
