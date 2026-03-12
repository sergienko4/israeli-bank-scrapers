/** Delay after a login step completes before proceeding (ms). */
export const LOGIN_STEP_WAIT_MS = 1500;

/** Maximum number of retry attempts for HTTP 403 WAF blocks. */
export const MAX_403_RETRIES = 2;

/** Delay between WAF 403 retry attempts (ms). */
export const WAF_RETRY_DELAY_MS = 15_000;
