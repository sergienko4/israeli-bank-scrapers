/**
 * Cross-cutting timing primitives — shared across every phase and not
 * owned by any single phase folder. Split out of {@link "./TimingConfig.js"}
 * during Phase 12b (KG-driven decoupling of the 481-LoC config hub).
 *
 * <p>Conventions and rationale for each constant are preserved from
 * the original file; the only change is physical location. Importers
 * may continue to use the {@link "./TimingConfig.js"} barrel during
 * the v8.5 release window — that barrel re-exports every constant
 * here verbatim. New code SHOULD import directly from this domain
 * file to make the cross-cutting nature explicit.
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
 * Phase settle — fixed delay applied TWICE per phase:
 * once before phase.PRE work begins, once after phase.FINAL completes.
 * So each phase's wall-clock is bookended by a wait window in which
 * the bank's SPA can finish settling and the page's anti-bot JS can
 * observe a "human-paused-on-the-page" interval before our next
 * interaction.
 *
 * <p>Was previously a single "between phases" settle (PR #233 fix
 * for Hapoalim "no login nav link found"). Split into PRE + FINAL on
 * 2026-05-17 after Hapoalim hCaptcha on PR #234 — the silent single
 * window was profiled as bot by Incapsula. Splitting gives the page
 * more contact-window time to settle naturally, and the next step
 * (planned) is to humanize each window with small mouse / scroll
 * events so Incapsula sees user-activity signals.
 *
 * <p>Applied at the SINGLE central chokepoint in
 * {@link "../../Core/Executor/PipelineReducer.js"} `reducePhases`
 * — no per-phase configuration, no per-bank override. PRE settle
 * fires on every phase (incl. terminal). FINAL settle is skipped for
 * the terminal phase so pipeline completion is not delayed. Failure
 * paths skip the FINAL settle so sanitization-pulse retries are not
 * penalized.
 */
export const PHASE_SETTLE_MS = 4000;

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
