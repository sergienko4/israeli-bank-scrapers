/**
 * CANARY — Scrape canonical-10 lookup-array → Set guard (PR #281 C8 §12C).
 *
 * This file intentionally exhibits the banned naming `lower*Keys` that
 * implies a key set for membership testing (PR #281 SonarCloud S7776 —
 * `JsonReplace.ts:47` SQ-3 + `RecordShape.ts:158` SQ-4). Its presence
 * here verifies — via `verify.sh` — that `eslint.config.mjs` §12C
 * fires on every local lint run, so the same anti-pattern can never
 * land in the canonical-10 sub-folders without local failure first.
 *
 * <h2>Expected behavior</h2>
 *
 * Running `npx eslint --no-ignore <this-file>` MUST report at least
 * one error. The canary harness in `verify.sh` checks `errorCount > 0`
 * — a parsing error (because canaries are excluded from tsconfig)
 * counts, so this file is guaranteed to satisfy the canary even when
 * the AST selector evolves.
 *
 * <p>NOTE: §12B's `max-lines-per-function` cap is disabled here so
 * the cap rule does NOT pre-empt §12C. The canary's purpose is to
 * document the BANNED-NAME-CONVENTION rule and act as a tripwire
 * if §12C is ever silently removed.</p>
 *
 * @canary scrape-canonical10-lookup-array-shouldbe-set
 */

const HAYSTACK = ['ALPHA', 'BETA', 'GAMMA'];
const NEEDLES = ['beta', 'delta'];

/**
 * Anti-pattern: builds a lowercased lookup array with the banned
 * `lowerKeys` name (§12C). The correct form would be
 * `lowerKeySet = new Set(HAYSTACK.map(k => k.toLowerCase()))`.
 *
 * @returns First needle present in HAYSTACK or null.
 */
// eslint-disable-next-line max-lines-per-function -- canary deliberately exhibits §12C anti-pattern; cap not the point
function findFirstHitAntiPattern(): string | null {
  const lowerKeys = HAYSTACK.map((k): string => k.toLowerCase());
  for (const needle of NEEDLES) {
    if (lowerKeys.includes(needle)) {
      return needle;
    }
  }
  return null;
}

export { findFirstHitAntiPattern };
