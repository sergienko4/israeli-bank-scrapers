/**
 * Canary — closes spec.txt §1 RC-8 (`typescript:S7763`).
 *
 * <p>Verifies the `unicorn/prefer-export-from` rule fires on
 * the import-then-export anti-pattern. With
 * `ignoreUsedVariables: false` (the scoped flip applied under
 * `src/Scrapers/Base/**`), the rule catches every manual
 * re-export — the canary file would also surface the rule if placed
 * in that scope. Lives in the canary directory so the harness
 * invokes ESLint with `--no-ignore` regardless of the scope
 * gate.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-8):
 * <ul>
 *   <li>`design-patterns-guidlines.md` — "Avoid duplication."</li>
 *   <li>`coding-principle-guidlines.md` §5 — SOLID Open/Closed.</li>
 * </ul>
 */

import { redactAccount } from '../Types/PiiRedactor.js';

/**
 * Anchor function — keeps the canary file non-empty when the linter
 * skips bare re-export statements with no other content.
 * @returns Always `'canary'` so the export below ties back.
 */
function anchor(): string {
  return redactAccount('canary');
}

// Deliberate violation — manual re-export of the imported symbol
// instead of the shorthand `export { redactAccount } from '...'`.
export { anchor, redactAccount };
