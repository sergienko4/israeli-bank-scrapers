/** Standard JSON content type for API request headers. */
export const JSON_CONTENT_TYPE = 'application/json';

/** Native fetch() timeout — bank APIs rarely take longer than this. */
export const NETWORK_FETCH_TIMEOUT_MS = 30_000;

/**
 * Extra budget given to the in-page abort on top of {@link NETWORK_FETCH_TIMEOUT_MS}.
 *
 * The deadline is enforced in Node via `timeoutPromise` because that is the only
 * realm where the rejection can be classified reliably: a page-realm
 * `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`, but
 * that type does not survive `page.evaluate` — Playwright reconstructs a plain
 * `Error` whose message is engine-specific text.
 *
 * The in-page abort is kept as a backstop so an abandoned request still releases
 * browser-side resources. The grace makes the ordering deterministic: Node
 * always reaches its deadline first, so the classified error is the one callers
 * observe, and the page abort only fires if the Node timer is starved.
 */
export const NETWORK_FETCH_PAGE_GRACE_MS = 5_000;

/** In-page abort backstop — deliberately later than the Node-side deadline. */
export const NETWORK_FETCH_PAGE_TIMEOUT_MS = NETWORK_FETCH_TIMEOUT_MS + NETWORK_FETCH_PAGE_GRACE_MS;

/** Response body patterns that indicate a WAF or IP block. */
export const WAF_BLOCK_PATTERNS = [
  'block automation',
  'attention required',
  'just a moment',
  'access denied',
] as const;

/** HTTP status codes that indicate a WAF or rate-limit block (403 is permission, not WAF). */
export const WAF_STATUS_CODES = new Set([429, 503]);

/** Maximum characters to include in response body previews for logging. */
export const BODY_PREVIEW_LIMIT = 300;
