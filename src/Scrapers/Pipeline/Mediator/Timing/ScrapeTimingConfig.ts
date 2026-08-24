/**
 * SCRAPE-phase timing budgets.
 *
 * <p>Both values are best-effort ceilings on the organic dashboard
 * click. The transaction traffic they wait for is normally already
 * captured in LOGIN.POST, so expiry here degrades to the direct API
 * path rather than failing the phase.
 */

/** SCRAPE UI-trigger best-effort traffic wait. */
export const SCRAPE_UI_TRAFFIC_TIMEOUT_MS = 5000;

/** SCRAPE WK element-discovery timeout. */
export const SCRAPE_UI_WK_TIMEOUT_MS = 5000;
