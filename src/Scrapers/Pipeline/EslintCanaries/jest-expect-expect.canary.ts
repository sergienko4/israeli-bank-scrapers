/**
 * Canary — closes spec.txt §1 RC-7 (`typescript:S2699` /
 * `typescript:S5914`).
 *
 * <p>Verifies the `jest/expect-expect` rule fires on an
 * `it()` block that contains no `expect()` call. The rule
 * guards "every test must have a clear purpose and measurable
 * outcome" from `test-guidlines.md`.
 *
 * <p>Note: the rule is scoped to `src/Tests/Unit/**` in
 * `eslint.config.mjs`; the canary file lives outside that
 * scope so to validate the rule the verifier runs ESLint directly
 * with `--rule 'jest/expect-expect: error'` via the canary
 * harness. The harness already invokes ESLint with
 * `--no-ignore` so this file is processed.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-7):
 * <ul>
 *   <li>`test-guidlines.md` — "Every test must have a clear
 *       purpose and measurable outcome."</li>
 *   <li>`test-cases-guidlines.md` §5 — "Positive & Negative
 *       Coverage."</li>
 * </ul>
 */

/** Stub Jest API surface so the canary lints without `@types/jest`. */
declare function it(name: string, fn: () => void): void;

/**
 * Deliberate violation — `it()` block with no
 * `expect()` call.
 * @returns Always true.
 */
function declareTestWithoutAssertion(): boolean {
  it('canary — no expect call', () => {
    const noop = 1 + 1;
    return Boolean(noop);
  });
  return true;
}

export { declareTestWithoutAssertion };
