/**
 * Canary — closes spec.txt §1 RC-6 (`typescript:S2933`).
 *
 * <p>Verifies the `@typescript-eslint/prefer-readonly` rule
 * fires on a private field that is assigned once at declaration and
 * never reassigned. The rule guards the project's immutability
 * contract (Rule #15 / `design-patterns-guidlines.md` "Prefer
 * immutable flows").
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-6):
 * <ul>
 *   <li>`design-patterns-guidlines.md` — "Prefer composition
 *       over inheritance" + "Prefer immutable flows."</li>
 *   <li>`general-rules-guidlines.md` P6 — "DI: dependencies
 *       resolved at construction time."</li>
 * </ul>
 */

/**
 * Deliberate violation — the private field
 * `_neverReassigned` is initialised once and never written
 * again; the rule must demand `private readonly`.
 */
class CanaryReadonlyClass {
  private _neverReassigned = 'canary';

  /**
   * Read the never-reassigned field so it is not tree-shaken.
   * @returns The field value.
   */
  public read(): string {
    return this._neverReassigned;
  }
}

export { CanaryReadonlyClass };
