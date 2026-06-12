/**
 * TERMINATE-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/**
 * TERMINATE per-cleanup wall-clock budget. Wraps every cleanup
 * function in `Promise.race` so a hung cleanup cannot stall the LIFO
 * walk (Isracard regression: live run 10-05-2026_02023248 hung 9 min
 * because page.close waits for network-idle while the bank's
 * frontend keepAlive POSTs every 30s).
 *
 * <p>This module is the sole owner of the TERMINATE-phase timing
 * budget and intentionally exports a single named constant — the
 * Phase 12b split keeps every domain in its own file so the
 * {@link "./TimingConfig.js"} barrel can re-export each name
 * verbatim without renaming. The `import-x/prefer-default-export`
 * rule is disabled for `Mediator/Timing/**` in `eslint.config.mjs`
 * section 7d for exactly this reason.
 */
export const TERMINATE_CLEANUP_BUDGET_MS = 5000;
