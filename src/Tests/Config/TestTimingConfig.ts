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
 *   300_000 ms = 5 minutes. Smoke tests use *synthetic* invalid creds, so the
 *   bank's auth endpoint MUST reject within a bounded time; this cap exists to
 *   catch CAPTCHA loops, WAF stalls and true network hangs FAST rather than
 *   burning SCRAPE_TIMEOUT (15 min).
 *
 *   <p>Raised from 180_000 after measuring the real jest durations of all 17
 *   matrix cells across consecutive CI runs. The flat 180 s cap was not a
 *   ceiling with headroom — it was sitting *on* the FIBI group:
 *     Otsar Hahayal 180 s (killed)   Pagi 180 s (killed)
 *     Massad        171 s (95 %)     Leumi 166 s (92 %)
 *     Yahav         125 s (70 %)     Hapoalim 116 s (64 %)
 *   Everything else finishes under 110 s. A run where all 17 cells passed was
 *   therefore luck, not proof: four cells were within 8 % of the cliff, so the
 *   gate would have flapped red on ordinary bank-latency variance once it
 *   became a required merge check.
 *
 *   <p>300 s is ~1.67x the observed 180 s ceiling — the same headroom ratio
 *   `SMOKE_TIMEOUT_PRE_LOGIN` gives its own 254 s peak — and still only a third
 *   of SCRAPE_TIMEOUT, so a genuine hang stays bounded. `reportSmokeHeadroom`
 *   now prints each cell's budget usage and annotates any run above
 *   `SMOKE_HEADROOM_WARN_RATIO`, so the next bank to creep toward the cap is
 *   visible BEFORE it turns the gate red.
 */
export const SMOKE_TIMEOUT = 300_000;

/** Smoke budget for banks that run a PRE-LOGIN phase (ms).
 *
 *   420_000 ms = 7 minutes. PRE-LOGIN is *pre-submit* navigation — reveal the
 *   login area, wait for the form to mount — and its probe ceilings in
 *   `PreLoginTimingConfig.ts` are 15 s apiece. Forensic `pipeline.log` captures
 *   measured HOME + PRE-LOGIN alone at 211 s (Amex), 217 s (Max) and 221 s
 *   (Isracard): over the flat 180 s budget before a credential is ever
 *   submitted, so the test died mid-navigation and never reached a login
 *   verdict. Adding the measured login round trip (21-35 s) puts the worst
 *   observed floor near 256 s; 420 s leaves headroom for CI network latency to
 *   Israeli banks while staying far below SCRAPE_TIMEOUT, so a genuine hang is
 *   still bounded. `SmokeBudget.test.ts` derives which banks need this from the
 *   real pipeline descriptors, so it cannot drift.
 */
export const SMOKE_TIMEOUT_PRE_LOGIN = 420_000;

/** Scraper-internal navigation timeout for the Amex smoke run (ms).
 *
 *   Distinct from the jest budgets above: this is passed to `createScraper()`
 *   as `defaultTimeout`, so it caps each individual Playwright navigation
 *   rather than the whole test. Amex needs a wider per-navigation ceiling than
 *   the Playwright default because its multi-frame API login stalls on slow
 *   frame mounts.
 */
export const SMOKE_NAV_TIMEOUT_AMEX = 60_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;

/** Chromium launch arguments for CI environments. */
export const CI_BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
