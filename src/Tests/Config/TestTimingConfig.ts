/**
 * Maximum time allowed for a full scrape operation in E2E tests (ms).
 *
 * 900_000 ms = 15 minutes. This Jest-level ceiling covers the entire HTTP
 * login and scrape attempt, including OTP retrieval and bank response waits.
 * It is separate from the scrape phase's own request and account budgets.
 */
export const SCRAPE_TIMEOUT = 900_000;

/** Default timeout for async Jest test operations (ms). */
export const ASYNC_TIMEOUT = 240000;
