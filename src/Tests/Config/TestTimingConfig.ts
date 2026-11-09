/**
 * Maximum time allowed for a full scrape operation in E2E tests (ms).
 *
 * 900_000 ms = 15 minutes. Slow-bank SPA login (VisaCal/MAX cal-online
 * stack) can spend ~4 minutes in login+dashboard before the scrape
 * phase even begins. The per-account 90s cap and 180s global scrape
 * budget in ScrapeDispatch.ts bound scrape duration separately, so
 * this jest-level ceiling only protects against pathological hangs
 * further upstream.
 */
export const SCRAPE_TIMEOUT = 900_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;
