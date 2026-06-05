/** Standard JSON content type for API request headers. */
export const JSON_CONTENT_TYPE = 'application/json';

/** Native fetch() timeout — bank APIs rarely take longer than this. */
export const NETWORK_FETCH_TIMEOUT_MS = 30_000;

/** Response body patterns that indicate a WAF or IP block. */
export const WAF_BLOCK_PATTERNS = [
  'block automation',
  'attention required',
  'just a moment',
  'access denied',
] as const;

/** HTTP status: 200 OK. */
export const HTTP_STATUS_OK = 200;

/** HTTP status: 204 No Content. */
export const HTTP_STATUS_NO_CONTENT = 204;

/** HTTP status: 429 Too Many Requests (WAF / rate-limit). */
export const HTTP_STATUS_RATE_LIMITED = 429;

/** HTTP status: 503 Service Unavailable (WAF / origin outage). */
export const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;

/** HTTP status codes that indicate a WAF or rate-limit block (403 is permission, not WAF). */
export const WAF_STATUS_CODES = new Set([
  HTTP_STATUS_RATE_LIMITED,
  HTTP_STATUS_SERVICE_UNAVAILABLE,
]);

/** Maximum characters to include in response body previews for logging. */
export const BODY_PREVIEW_LIMIT = 300;

/** Number of trailing URL characters kept in API-call logs (PII-safe redaction). */
export const URL_LOG_TAIL_CHARS = 100;
