/** Standard JSON content type for API request headers. */
export const JSON_CONTENT_TYPE = 'application/json';

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
