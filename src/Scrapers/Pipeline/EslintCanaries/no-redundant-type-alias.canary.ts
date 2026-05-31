/**
 * Canary — closes spec.txt §1 RC-5 (`typescript:S6564`).
 *
 * <p>Verifies the `sonarjs/redundant-type-aliases` rule fires
 * on a bare `type X = string` alias. The pipeline replaces
 * such aliases with structural unions (see
 * `Pipeline/Types/JsonValue.ts`) or branded nominal types
 * (see `Pipeline/Types/Brand.ts`) so Sonar accepts the RHS as
 * non-redundant.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-5):
 * <ul>
 *   <li>`before-commit-guidlines.md` §2 — "Never weaken eslint,
 *       guards, validation, or thresholds."</li>
 *   <li>`design-patterns-guidlines.md` — "Avoid duplication."</li>
 * </ul>
 */

/** Deliberate violation — single-keyword RHS triggers S6564. */
type RedundantStringAlias = string;

/**
 * Anchor the canary alias so the rule has something to fire on
 * (declared-only types are tree-shaken before lint in some pipelines).
 * @returns The literal `'canary'` token typed as the alias.
 */
function mintRedundant(): RedundantStringAlias {
  return 'canary';
}

export { mintRedundant };
