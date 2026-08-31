/**
 * Canary — closes spec.txt §1 RC-7 (`typescript:S2699` /
 * `typescript:S5914`).
 *
 * <p>Verifies the `jest/expect-expect` rule fires on an
 * `it()` block that contains no `expect()` call. The rule
 * guards "every test must have a clear purpose and measurable
 * outcome" from `test-guidlines.md`.
 *
 * <p>Note: `jest/expect-expect` is scoped to `src/Tests/Unit/**` for
 * production tests; this file lives outside that scope, so the rule is
 * armed on it explicitly by an `eslint.config.mjs` block keyed to this
 * exact path. That block also declares the jest globals — WITHOUT them
 * eslint-plugin-jest resolves `it` through scope, finds a local
 * declaration rather than a global, and silently skips the call. A
 * `declare function it(...)` stub used to sit here and was itself the
 * reason the canary never fired. Do not reintroduce one.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-7):
 * <ul>
 *   <li>`test-guidlines.md` — "Every test must have a clear
 *       purpose and measurable outcome."</li>
 *   <li>`test-cases-guidlines.md` §5 — "Positive & Negative
 *       Coverage."</li>
 * </ul>
 *
 * canary-expects-rule: jest/expect-expect
 */

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
