/**
 * Centralized timing configuration — single source of truth for every
 * wait-budget ceiling across the Pipeline mediator. Per-phase
 * constants previously scattered across each phase's actions file
 * land here so tuning, audit, and the `R-NO-FIXED-WAIT-15S`
 * architecture rule operate on ONE file.
 *
 * <p>Naming convention: every export ends in `_MS` and starts with
 * the phase prefix (HOME / PRELOGIN / LOGIN / OTP / AUTH_DISCOVERY /
 * ACCOUNT_RESOLVE / DASHBOARD / NETWORK / SCRAPE / TERMINATE /
 * ELEMENTS). Architecture rule R-NO-FIXED-WAIT-15S blocks any new
 * 15s ceiling outside the documented Playwright-defined allowlist.
 *
 * <p>Mission origins documented inline so a future tuner sees the
 * commit + plan reference behind each value.
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

// ── INIT phase ─────────────────────────────────────────────────────

/**
 * INIT.ACTION navigation commit ceiling — Mission M4.F1 follow-up.
 * Replaces Playwright's 30 s default with a 15 s commit-only wait.
 * `page.goto(url, { waitUntil: 'commit' })` returns as soon as the
 * server responds with the first byte (TLS done + HTTP headers
 * received). Camoufox-isolated probe (2026-05-10) measured every
 * browser-flow bank below 1 s for `commit`; the 15 s ceiling
 * absorbs the 10× slowdown observed when the pre-commit hook runs
 * 6 banks in parallel and Camoufox launches contend for bandwidth.
 */
export const INIT_NAV_COMMIT_TIMEOUT_MS = 15_000;

/**
 * INIT.FINAL `domcontentloaded` ceiling — Mission M4.F1 follow-up.
 * `page.waitForLoadState('domcontentloaded')` resolves when the
 * HTML parser finishes — DOM is usable. We deliberately do NOT
 * wait for the `load` event because half the browser-flow banks
 * (max / amex / isracard) take 12–15 s to fire `load` (analytics,
 * marketing scripts, fonts) — work the framework never reads.
 * Camoufox-isolated probe measured every bank under 3.5 s for
 * `domcontentloaded`; the 10 s ceiling absorbs parallel-run
 * variance.
 */
export const INIT_DOM_READY_TIMEOUT_MS = 10_000;

// ── HOME phase ─────────────────────────────────────────────────────

/** HOME settle ceiling after click — TIMING mission cut from 15000. */
export const HOME_SETTLE_TIMEOUT_MS = 8000;

/** HOME login-link / form-gate probe ceiling — TIMING cut from 15000. */
export const HOME_ENTRY_TIMEOUT_MS = 5000;

/** HOME SPA URL change wait after click (Angular routing delay). */
export const HOME_SPA_NAV_TIMEOUT_MS = 10000;

/** HOME form-ready gate probe — bank-side rendering ceiling. */
export const HOME_FORM_READY_TIMEOUT_MS = 15000;

/** HOME modal-overlay settle ceiling. */
export const HOME_MODAL_SETTLE_TIMEOUT_MS = 15000;

// ── PRE-LOGIN phase ────────────────────────────────────────────────

/** PRE-LOGIN reveal-button discovery probe ceiling. */
export const PRELOGIN_DISCOVER_TIMEOUT_MS = 15000;

/** PRE-LOGIN private-customers nav ceiling. */
export const PRELOGIN_REVEAL_NAV_TIMEOUT_MS = 15000;

/** PRE-LOGIN target-resolve ceiling. */
export const PRELOGIN_RESOLVE_TARGET_TIMEOUT_MS = 5000;

/** PRE-LOGIN credential-area click ceiling. */
export const PRELOGIN_CRED_AREA_TIMEOUT_MS = 10000;

/** PRE-LOGIN form-gate validation probe ceiling. */
export const PRELOGIN_FORM_GATE_TIMEOUT_MS = 5000;

/** PRE-LOGIN OTP/password field probe ceiling. */
export const PRELOGIN_FORM_PROBE_TIMEOUT_MS = 3000;

/** PRE-LOGIN POST settle before login gate. */
export const PRELOGIN_FORM_POST_TIMEOUT_MS = 15000;

// ── LOGIN phase ────────────────────────────────────────────────────

/** LOGIN form-frame scan budget per frame. */
export const LOGIN_PER_FRAME_SCAN_TIMEOUT_MS = 3000;

/** LOGIN post-submit settle ceiling. */
export const LOGIN_POST_SUBMIT_SETTLE_TIMEOUT_MS = 15000;

/** LOGIN traffic-wait ceiling for organic SPA traffic — TIMING cut from 30000. */
export const LOGIN_TRAFFIC_WAIT_TIMEOUT_MS = 10000;

/** LOGIN cookie-audit network-idle wait. */
export const LOGIN_COOKIE_AUDIT_NETWORK_IDLE_MS = 10000;

// ── OTP phases (TRIGGER + FILL + form probe) ───────────────────────

/** OTP trigger / fill post-action settle ceiling — TIMING cut from 10000. */
export const OTP_PHASE_SETTLE_TIMEOUT_MS = 5000;

/** OTP-TRIGGER POST scope-bound visibility re-probe ceiling — Mission 4. */
export const OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS = 2000;

/** OTP form-input discovery probe ceiling. */
export const OTP_FORM_PROBE_TIMEOUT_MS = 3000;

/** OTP submit-button discovery probe ceiling — TIMING cut from 15000. */
export const OTP_SUBMIT_PROBE_TIMEOUT_MS = 5000;

/** OTP error-banner probe ceiling. */
export const OTP_ERROR_PROBE_TIMEOUT_MS = 2000;

/** OTP retriever pre-prompt settle. */
export const OTP_RETRIEVER_SETTLE_MS = 500;

/**
 * OTP user entry budget — single test case may extend per options.
 * Imported via re-export from `OtpFillPhaseActions.ts` so the
 * existing `Tests/Unit/.../OtpPollerPipelineTimeoutAlignment.test.ts`
 * cross-validation continues to pass without renaming.
 */
export const DEFAULT_OTP_TIMEOUT_MS = 180_000;

// ── AUTH-DISCOVERY phase ───────────────────────────────────────────

/** AUTH-DISCOVERY dashboard reveal probe budget — TIMING cut from 8000. */
export const AUTH_DISCOVERY_DASHBOARD_WAIT_MS = 3000;

/** AUTH-DISCOVERY auth-module sessionStorage poll ceiling — TIMING cut from 10000. */
export const AUTH_POLL_TIMEOUT_MS = 3_000;

/**
 * AUTH-DISCOVERY.PRE settle ceiling — gives the SPA time to flush
 * post-login redirect chatter (auth-token endpoints, header-bearer
 * fetches, redirect navigation) before AUTH-DISCOVERY.PRE inventories
 * the capture pool. Event-driven via `mediator.waitForNetworkIdle`
 * (early-exits the moment the network goes idle), so fast banks pay
 * 0 ms while slow-redirect banks pay up to this ceiling. Starts at
 * 3 s per architectural review — increase only if a slow-redirect
 * bank empirically requires it.
 */
export const AUTH_DISCOVERY_PRE_SETTLE_MS = 3_000;

/**
 * AUTH-DISCOVERY.FINAL settle ceiling — Mission M4.F1. Before FINAL
 * reads `mediator.getCurrentUrl()` to compare against the URL
 * LOGIN.PRE emitted, give the page one more event-driven idle wait
 * (1 s ceiling) so the URL we compare against is the FINAL post-auth
 * URL, not a transient redirect intermediate. Fast banks pay 0 ms;
 * banks with a slow last redirect pay up to the ceiling.
 */
export const AUTH_DISCOVERY_FINAL_SETTLE_MS = 1_000;

// ── ACCOUNT-RESOLVE phase ──────────────────────────────────────────

/**
 * ACCOUNT-RESOLVE first-id-bearing-capture wait budget. Bumped from
 * 10s to 20s after live Discount run 10-05-2026_02325569 timed out
 * with `pool=1` while the previous run had `pool=72`. Serves as a
 * cumulative-cut absorber: TIMING reductions to upstream phases
 * shift this phase earlier in absolute time, so a longer ceiling
 * keeps slow-bank runs reliable.
 */
export const ACCOUNT_RESOLVE_BUDGET_MS = 20_000;

/** ACCOUNT-RESOLVE poll interval driving the recursive wait-loop. */
export const ACCOUNT_RESOLVE_POLL_MS = 250;

// ── DASHBOARD phase ────────────────────────────────────────────────

/** DASHBOARD SPA transaction-link probe ceiling. */
export const DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS = 15000;

/** DASHBOARD menu settle after toggle click. */
export const DASHBOARD_MENU_SETTLE_MS = 5000;

/** DASHBOARD post-login redirect settle — TIMING cut from 15000. */
export const DASHBOARD_SETTLE_MS = 5000;

/** DASHBOARD success-probe resolveVisible ceiling — TIMING cut from 30000. */
export const DASHBOARD_SUCCESS_TIMEOUT_MS = 8000;

/** DASHBOARD reveal-string resolveVisible ceiling — TIMING cut from 15000. */
export const DASHBOARD_REVEAL_TIMEOUT_MS = 3000;

/** DASHBOARD SPA-render timeout for href-extraction probe. */
export const DASHBOARD_TRIGGER_RENDER_TIMEOUT_MS = 10000;

/** DASHBOARD date-filter element-visible ceiling. */
export const DASHBOARD_DATE_FILTER_TIMEOUT_MS = 5000;

/** DASHBOARD organic nav + filter settle — TIMING cut from 15000. */
export const DASHBOARD_ORGANIC_IDLE_MS = 3000;

/** DASHBOARD wait after txn-endpoint match before SCRAPE handoff. */
export const DASHBOARD_POST_MATCH_TXN_WAIT_MS = 4000;

/** DASHBOARD final TXN URL capture wait. */
export const DASHBOARD_FINAL_TXN_WAIT_MS = 8000;

/** DASHBOARD change-password probe timeout. */
export const DASHBOARD_CHANGE_PWD_TIMEOUT_MS = 3000;

// ── NETWORK ────────────────────────────────────────────────────────

/** Fire-and-forget POST interceptor timeout — TIMING cut from 120000. */
export const NETWORK_POST_INTERCEPT_TIMEOUT_MS = 30_000;

/** Network capture poll interval for `waitForFirstId`. */
export const NETWORK_WAIT_FIRST_ID_POLL_MS = 250;

// ── SCRAPE / TERMINATE ─────────────────────────────────────────────

/** SCRAPE UI-trigger best-effort traffic wait. */
export const SCRAPE_UI_TRAFFIC_TIMEOUT_MS = 5000;

/** SCRAPE WK element-discovery timeout. */
export const SCRAPE_UI_WK_TIMEOUT_MS = 5000;

/**
 * TERMINATE per-cleanup wall-clock budget. Wraps every cleanup
 * function in `Promise.race` so a hung cleanup cannot stall the LIFO
 * walk (Isracard regression: live run 10-05-2026_02023248 hung 9 min
 * because page.close waits for network-idle while the bank's
 * frontend keepAlive POSTs every 30s).
 */
export const TERMINATE_CLEANUP_BUDGET_MS = 5000;

// ── ELEMENTS / interactions ────────────────────────────────────────
//
// Allowlisted under R-NO-FIXED-WAIT-15S because they are Playwright-
// driven primitives, not phase-wall budgets.

/** Playwright click action timeout — generic primitive. */
export const ELEMENTS_CLICK_TIMEOUT_MS = 15_000;

/** Click forensics evaluate ceiling — short-cap, non-blocking. */
export const ELEMENTS_FORENSICS_EVAL_TIMEOUT_MS = 1_500;

/** Element-mediator JS evaluate ceiling. */
export const ELEMENTS_EVALUATE_TIMEOUT_MS = 5_000;

/** Element-mediator delay between loading-indicator polls. */
export const ELEMENTS_LOADING_DELAY_MS = 2_000;

/** Element-mediator click-race ceiling. */
export const ELEMENTS_CLICK_RACE_TIMEOUT_MS = 3_000;

/** Element-mediator network-idle ceiling — generic primitive. */
export const ELEMENTS_NETWORK_IDLE_TIMEOUT_MS = 15_000;

/** Element-mediator URL-wait ceiling. */
export const ELEMENTS_URL_WAIT_TIMEOUT_MS = 10_000;
