/**
 * Shared "is this Playwright `press()` rejection a benign no-op?"
 * predicate used by the Enter-fallback submit helpers to narrow
 * their catch blocks (CR PR #345 round-2 findings on
 * `pressEnterOrFalse` / `pressEnterByIdOrFalse`).
 *
 * <p>The Enter-press path is best-effort: when the selector matches
 * nothing, the form is gone, or the locator times out, that's the
 * EXPECTED outcome and the caller's click-fallback is the rescue.
 * Any OTHER rejection (e.g. a mediator bug, a real JS exception in
 * a page handler) is a real bug that MUST surface so we don't
 * silently mask it (coding-principle §9 "ERROR HANDLING SECURITY").
 *
 * <p>Mirrors {@link ../ErrorDiscovery/ErrorDiscoveryDetached.ts} —
 * kept separate because the Actions/ folder owns its own benign
 * set (TimeoutError + locator-miss) which the ErrorDiscovery probe
 * deliberately does NOT swallow.
 */

/**
 * Substrings observed in Playwright `press()` rejections that
 * correspond to "no input element here" / "page is gone" — i.e.
 * benign signals for the Enter-fallback submit path.
 *
 * <p>Exported so the dedicated unit-test fixture can assert each
 * pattern is still matched after future Playwright upgrades.
 */
export const BENIGN_PRESS_PATTERNS: readonly string[] = [
  'Target page, context or browser has been closed',
  'Execution context was destroyed',
  'has been detached',
  'Frame was detached',
  'Frame detached',
  'no element matches selector',
  'waiting for selector',
  'strict mode violation',
];

/**
 * Nominal brand for the press-rejection classification — satisfies
 * Rule #15 ("no primitive returns at module boundaries") per the
 * `Pipeline/Types/Brand.ts` pattern. The value is still a runtime
 * `boolean`; the brand is type-only.
 */
export type BenignPressSignal = boolean & { readonly __brand: 'BenignPressSignal' };

/**
 * True when the rejection is one of the expected "Enter could not
 * fire" signals (timeout, locator miss, frame gone). False for
 * anything else — that rejection MUST propagate so real bugs
 * surface in the submit phase.
 * @param err - Rejection value caught from a Playwright `press()` call.
 * @returns Branded boolean — `true` iff the error is benign.
 */
export function isBenignPressReject(err: unknown): BenignPressSignal {
  if (!(err instanceof Error)) return false as BenignPressSignal;
  if (err.name === 'TimeoutError') return true as BenignPressSignal;
  const isMatch = BENIGN_PRESS_PATTERNS.some((pat): boolean => err.message.includes(pat));
  return isMatch as BenignPressSignal;
}
