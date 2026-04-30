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
 *   180_000 ms = 3 minutes. Smoke tests use *synthetic* invalid creds, so
 *   the bank's auth endpoint MUST reject within reasonable time. Per-bank
 *   floor observed in the matrix CI (fresh ubuntu runner + camoufox cold
 *   start + Israel-bank network latency):
 *     - fast banks  (Mizrahi/OneZero/Yahav/Mercantile): 30-90s
 *     - slow banks  (Hapoalim/VisaCal/Beinleumi/Amex/Isracard/Max/Leumi
 *                    /Discount/Massad/OtsarHahayal/Pagi): 90-180s
 *   These slow banks run multi-step Angular SPA logins (cal-online stack,
 *   Hapoalim Angular, Beinleumi modal, Amex/Isracard multi-frame API)
 *   that legitimately need 2-3 minutes for invalid-creds round trips.
 *   We hard-cap at 180s to catch CAPTCHA-loops / WAF stalls / true
 *   network hangs FAST instead of burning SCRAPE_TIMEOUT (15min).
 */
export const SMOKE_TIMEOUT = 180_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;

/** Maximum number of transactions to log in E2E test output. */
export const MAX_TXN_LOG = 10;

/** Chromium launch arguments for CI environments. */
export const CI_BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
