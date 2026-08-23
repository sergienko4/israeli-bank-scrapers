/**
 * Canary — closes spec.txt §1 RC-8 (`typescript:S7763`).
 *
 * <p>Verifies the `unicorn/prefer-export-from` rule fires on
 * the import-then-export anti-pattern. The rule is enforced
 * repo-wide with `checkUsedVariables: true` (eslint.config.mjs
 * §12e), so it catches every manual re-export — including this
 * one, where `redactAccount` is imported, used locally by
 * `anchor()`, and then re-exported. That "used locally" detail is
 * what makes this canary sensitive to the flag: loosening
 * `checkUsedVariables` back to `false` silences the rule here and
 * `verify.sh` then fails the canary as dead. Lives in the canary
 * directory so the harness invokes ESLint with `--no-ignore`
 * regardless of the global ignore.
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
