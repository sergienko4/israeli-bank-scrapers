/**
 * PII-safe response digest for api-direct fetches.
 *
 * <p>Scrape-phase fetches historically logged only `verb`/`url`/`status`,
 * so an app-level rejection was invisible: PayBox answers a malformed
 * request with `{code, name, message, explanation}` — and often does so
 * under HTTP 200, where a status-only log reads as success. Three
 * separate PayBox investigations stalled on exactly this blind spot.
 *
 * <p>Only machine identifiers are surfaced. `message` and `explanation`
 * are free-text fields that can embed customer data, so they are never
 * logged (`logging-pii-guidlines.md` §1 — allowlist, never blocklist).
 * `code` and `name` are stable enum-like identifiers and carry none.
 */

/** PII-safe descriptor emitted alongside a fetch's status line. */
export interface IResponseDigest {
  /**
   * UTF-8 **byte** length of the raw body. Deliberately not
   * `String.length`, which counts UTF-16 code units: a Hebrew error
   * envelope is ~2 bytes per character, so the code-unit count reads
   * roughly half the true wire size and makes a substantial rejection
   * body look like an empty page.
   */
  readonly respLength: number;
  readonly respKeys: readonly string[];
  readonly errorCode: string;
  readonly errorName: string;
}

/**
 * Narrow an already-parsed value to a top-level record, rejecting
 * arrays and scalars so field reads stay meaningful.
 * @param parsed - Value produced by JSON.parse.
 * @returns Top-level record (empty when not a plain object).
 */
function coerceRecord(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== 'object') return {};
  if (Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/**
 * Reduce a body to a top-level record, tolerating non-JSON and
 * non-object payloads (HTML error pages, arrays, bare scalars).
 * @param bodyText - Raw response text.
 * @returns Top-level record (empty when unparseable or not an object).
 */
function parseTopLevel(bodyText: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return coerceRecord(parsed);
  } catch {
    return {};
  }
}

/**
 * Read a field as a display string without leaking non-scalar values.
 * @param src - Parsed top-level record.
 * @param key - Field name to read.
 * @returns Scalar rendered as string; empty when absent or non-scalar.
 */
function stringField(src: Record<string, unknown>, key: string): string {
  const value = src[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Summarise a response body for logging without emitting any value that
 * could carry customer data.
 * @param bodyText - Raw response text.
 * @returns Digest safe to emit at DEBUG level.
 */
export function digestResponse(bodyText: string): IResponseDigest {
  const parsed = parseTopLevel(bodyText);
  return {
    respLength: Buffer.byteLength(bodyText, 'utf8'),
    respKeys: Object.keys(parsed),
    errorCode: stringField(parsed, 'code'),
    errorName: stringField(parsed, 'name'),
  };
}
