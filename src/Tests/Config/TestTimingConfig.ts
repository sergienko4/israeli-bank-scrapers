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

/** Maximum time allowed for an invalid-credentials smoke test (ms).
 *
 *   90_000 ms = 90 seconds. Smoke tests use *synthetic* invalid creds, so
 *   the bank's auth endpoint MUST reject within seconds (typical 30-60s
 *   including browser launch + page load + reject). We hard-cap at 90s to
 *   catch CAPTCHA-loops / WAF stalls / network hangs FAST instead of
 *   burning the SCRAPE_TIMEOUT 15-min budget on each bank — a 17-bank
 *   serial smoke run drops from 25min worst-case to ~10min realistic
 *   plus per-bank hang detection in 90s instead of 15min.
 */
export const SMOKE_TIMEOUT = 90_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;

/** Maximum number of transactions to log in E2E test output. */
export const MAX_TXN_LOG = 10;

/** Chromium launch arguments for CI environments. */
export const CI_BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
