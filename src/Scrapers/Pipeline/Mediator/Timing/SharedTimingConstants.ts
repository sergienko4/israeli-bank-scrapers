/**
 * Cross-cutting timing primitives — shared across every phase and not
 * owned by any single phase folder. Split out of the TimingConfig
 * barrel during Phase 12b (KG-driven decoupling of the 481-LoC config
 * hub).
 *
 * <p>Conventions and rationale for each constant are preserved from
 * the original file; the only change is physical location. The barrel
 * was retired once every importer moved to a domain file, so this is
 * now the canonical definition for these constants. `Waiting.ts` still
 * re-exports `SECOND` for its own consumers.
 */

/** One second in milliseconds — base unit for timeout arithmetic. */
export const SECOND = 1000;

/** Default timeout for waitUntil polling (ms). */
export const DEFAULT_WAIT_TIMEOUT_MS = 10000;

/** Default polling interval for waitUntil (ms). */
export const DEFAULT_WAIT_INTERVAL_MS = 100;

/** Minimum human-like delay for general interactions (ms). */
export const HUMAN_DELAY_MIN_MS = 300;

/** Maximum human-like delay for general interactions (ms). */
export const HUMAN_DELAY_MAX_MS = 1200;

/**
 * Minimum count of post-auth session cookies that, combined with
 * REVEAL=true, is considered sufficient corroboration to override
 * the M4.F1 URL-change requirement on same-URL SPAs (Isracard
 * `/StatusPage`). Sized below the live P5 across 6 banks
 * (Discount ≈ 12, Isracard ≈ 54-60) and above the typical
 * interstitial tracking-cookie count (2-3 third-party cookies).
 *
 * <p>Hosted in the shared timing module as the centralised audit
 * point for pipeline thresholds, even though this one is a count
 * rather than a millisecond ceiling.
 */
export const STRONG_AUTH_COOKIE_FLOOR = 5;

/** Sentinel budget for `'none'` prelude — never consulted (short-circuit). */
export const PRELUDE_NONE_BUDGET_MS = 0;
