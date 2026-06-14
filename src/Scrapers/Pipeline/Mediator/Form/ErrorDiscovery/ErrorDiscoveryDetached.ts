/**
 * Shared "is this Playwright error a benign element-gone signal?"
 * predicate used by error-discovery probes to narrow their catch
 * blocks (CR PR #345 findings #183, #186).
 *
 * <p>The error-discovery layer runs against a page that may navigate
 * mid-probe (especially during OTP transitions); a frame-detached
 * or context-destroyed rejection is the EXPECTED outcome and should
 * fall through to "no errors". Any OTHER rejection (e.g. a typo in
 * an ERROR_SELECTOR, a JS error in the page) is a real bug that
 * MUST surface so we don't silently mask it (coding-principle §9
 * "ERROR HANDLING SECURITY").
 */

/**
 * Substrings observed in Playwright detach / context-gone errors.
 * Matching is case-sensitive and uses `includes` so version drift
 * in Playwright's error prose stays best-effort tolerant.
 *
 * <p>Exported so the dedicated unit-test fixture can assert each
 * pattern is still matched after future Playwright upgrades.
 */
export const DETACHED_PATTERNS: readonly string[] = [
  'Target page, context or browser has been closed',
  'Execution context was destroyed',
  'has been detached',
  'Frame was detached',
  'Frame detached',
  'Navigation failed because',
];

/**
 * Nominal brand for the "is this Playwright error a benign element-gone
 * signal?" classification — satisfies Rule #15 ("no primitive returns
 * at module boundaries") per `Pipeline/Types/Brand.ts` pattern. The
 * value is still a runtime `boolean`; the brand is type-only.
 */
export type DetachedSignal = boolean & { readonly __brand: 'DetachedSignal' };

/**
 * True when the rejection looks like an expected element-gone signal
 * (frame detached, context destroyed, page closed, mid-nav).
 * @param err - Rejection value caught from a Playwright call.
 * @returns Branded boolean — `true` iff the error is one of the
 *   benign detach signals.
 */
export function isElementGoneError(err: unknown): DetachedSignal {
  if (!(err instanceof Error)) return false as DetachedSignal;
  const isMatch = DETACHED_PATTERNS.some((pat): boolean => err.message.includes(pat));
  return isMatch as DetachedSignal;
}
