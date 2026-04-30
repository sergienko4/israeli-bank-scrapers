/**
 * Maximum time allowed for a full scrape operation in E2E tests (ms).
 *
 * 900_000 ms = 15 minutes. Slow-bank SPA login (VisaCal/MAX cal-online
 * stack) can spend ~4 minutes in login+dashboard before the scrape
 * phase even begins. The per-account 90s cap and 180s global scrape
 * budget in ScrapeDispatch.ts bound scrape duration separately, so
 * this jest-level ceiling only protects against pathological hangs
 * further upstream (browser disconnect, frame detachment, etc.).
 */
export const SCRAPE_TIMEOUT = 900_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;

/** Maximum number of transactions to log in E2E test output. */
export const MAX_TXN_LOG = 10;

/** Chromium launch arguments for CI environments. */
export const CI_BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
