/**
 * SCRAPE-phase timing budgets. Split out of
 * {@link "./TimingConfig.js"} during Phase 12b — see file for the
 * rollout window during which the {@link "./TimingConfig.js"} barrel
 * still re-exports these names.
 */

/** SCRAPE UI-trigger best-effort traffic wait. */
export const SCRAPE_UI_TRAFFIC_TIMEOUT_MS = 5000;

/** SCRAPE WK element-discovery timeout. */
export const SCRAPE_UI_WK_TIMEOUT_MS = 5000;
