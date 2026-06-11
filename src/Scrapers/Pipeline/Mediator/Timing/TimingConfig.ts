/**
 * Centralized timing-configuration BARREL — single re-export hub for
 * every wait-budget ceiling across the Pipeline mediator.
 *
 * <p>Phase 12b (2026-06) split the original 481-LoC monolith into
 * domain files (one per phase + a `SharedTimingConstants` module).
 * This file now exists as a thin barrel so the 44 existing importers
 * keep working without a single import-path change during the v8.5
 * release window. New code SHOULD import directly from the
 * domain-specific file (e.g. {@link "./HomeTimingConfig.js"}) — that
 * makes phase ownership explicit and lets the Phase 12c/12d follow-up
 * delete this barrel cleanly.
 *
 * <p>Naming convention preserved: every export ends in `_MS` and
 * starts with the phase prefix (HOME / PRELOGIN / LOGIN / OTP /
 * AUTH_DISCOVERY / ACCOUNT_RESOLVE / DASHBOARD / NETWORK / SCRAPE /
 * TERMINATE / ELEMENTS) plus a cross-cutting `SharedTimingConstants`
 * bucket for primitives that are not owned by any single phase
 * (SECOND, DEFAULT_WAIT_*, HUMAN_DELAY_*, PHASE_SETTLE_MS,
 * STRONG_AUTH_COOKIE_FLOOR, PRELUDE_NONE_BUDGET_MS). The
 * R-NO-FIXED-WAIT-15S architecture rule still operates on the
 * union of all these files.
 *
 * @deprecated Re-export shim for v8.5 — import from the domain
 *   file directly. Scheduled for removal in v8.6.
 */

export * from './AccountResolveTimingConfig.js';
export * from './AuthDiscoveryTimingConfig.js';
export * from './DashboardTimingConfig.js';
export * from './ElementsTimingConfig.js';
export * from './HomeTimingConfig.js';
export * from './InitTimingConfig.js';
export * from './LoginTimingConfig.js';
export * from './NetworkTimingConfig.js';
export * from './OtpTimingConfig.js';
export * from './PreLoginTimingConfig.js';
export * from './ScrapeTimingConfig.js';
export * from './SharedTimingConstants.js';
export * from './TerminateTimingConfig.js';
