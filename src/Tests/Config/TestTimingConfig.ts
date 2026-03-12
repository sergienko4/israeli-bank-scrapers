/** Maximum time allowed for a full scrape operation in E2E tests (ms). */
export const SCRAPE_TIMEOUT = 120000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 120000;

/** Maximum number of transactions to log in E2E test output. */
export const MAX_TXN_LOG = 10;

/** Chromium launch arguments for CI environments. */
export const CI_BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
