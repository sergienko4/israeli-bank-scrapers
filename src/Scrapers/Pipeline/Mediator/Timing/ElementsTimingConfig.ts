/**
 * ELEMENTS / interaction-primitive timing budgets — Playwright-driven
 * primitives, not phase-wall budgets. Allowlisted under
 * R-NO-FIXED-WAIT-15S because they bound generic Playwright actions
 * (click, evaluate, network-idle, URL-wait) rather than per-phase
 * walls.
 *
 * <p>Split out of {@link "./TimingConfig.js"} during Phase 12b.
 */

/**
 * `domcontentloaded` lifecycle ceiling — shared cross-phase primitive.
 *
 * <p>Both INIT.FINAL and LOGIN.PRE call `waitForDomReady` from
 * {@link "../Elements/PageReadiness.js"} on the same ceiling. The HTML
 * parser typically finishes under 3.5 s on every browser-flow bank
 * (Camoufox-isolated probe, 2026-05-10); the 10 s budget absorbs the
 * 3× slowdown observed when the pre-commit hook runs six banks in
 * parallel and Camoufox launches contend for bandwidth. Waiting for
 * the `load` event would block 12–15 s on Max / Amex / Isracard
 * (analytics, marketing scripts) — work the framework never reads.
 */
export const ELEMENTS_DOM_READY_TIMEOUT_MS = 10_000;

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
