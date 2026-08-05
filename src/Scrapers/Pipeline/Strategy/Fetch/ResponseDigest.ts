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
 *
 * <p>`respKeys` names only the *envelope* fields, which for a successful
 * collection fetch is uninformative — PayBox's wallet history digests to
 * `["code","content"]` no matter what the rows contain. That blind spot
 * is why a blank-description defect could not be diagnosed from any log:
 * nothing ever named the row fields the bank actually sent. `rowKeys`
 * closes it by naming the fields of the first collection found in the
 * body. Field *names* are schema, not customer data, so the same
 * allowlist argument that permits `respKeys` permits `rowKeys`; values
 * are never read.
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
  /**
   * Field names of the first collection found in the body, sorted and
   * bounded. Empty when the body carries no array of records.
   */
  readonly rowKeys: readonly string[];
  readonly errorCode: string;
  readonly errorName: string;
}

/** Nesting levels searched for the first collection. */
const MAX_ROW_DEPTH = 4;

/** Rows sampled when unioning field names — enough to cover optional fields. */
const MAX_ROW_SAMPLE = 5;

/** Upper bound on emitted field names, so a wide row cannot flood a log line. */
const MAX_ROW_KEYS = 40;

/**
 * Keys are only safe to log while they are SCHEMA. A body keyed by a
 * value — an account reference, a phone number — turns the key space
 * into the data space, so only identifier-shaped names are kept.
 * Rejecting bare digits alone is not enough: `050-123-4567` is neither
 * numeric nor a field name.
 */
const SCHEMA_KEY = /^[A-Za-z_]\w*$/u;

/** Upper bound on a single key, so a long value posing as one cannot ride along. */
const MAX_KEY_LEN = 40;

/**
 * Decide whether a key names a schema field rather than data.
 * @param key - Candidate key.
 * @returns True when the key is identifier-shaped and short enough.
 */
function isSchemaKey(key: string): boolean {
  return key.length <= MAX_KEY_LEN && SCHEMA_KEY.test(key);
}

/**
 * Narrow a value to a plain object.
 * @param value - Candidate value.
 * @returns True when the value is a non-null, non-array object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Decide whether a node is a collection carrying at least one record.
 * @param node - Candidate node.
 * @returns True for an array holding a record.
 */
function isRecordArray(node: unknown): boolean {
  return Array.isArray(node) && node.some(isPlainRecord);
}

/**
 * Expand one nesting level into the values of its records.
 * @param level - Nodes at the current level.
 * @returns Nodes one level deeper.
 */
function descend(level: readonly unknown[]): unknown[] {
  const records = level.filter(isPlainRecord);
  return records.flatMap(node => Object.values(node));
}

/**
 * Locate the first array holding records, scanning one nesting level at
 * a time so a shallow collection wins over a deeper incidental one.
 * @param level - Nodes at the current level.
 * @param depth - Levels already scanned.
 * @returns First array holding at least one record; empty when none.
 */
function findRowArray(level: readonly unknown[], depth: number): readonly unknown[] {
  const hit = level.find(isRecordArray);
  if (Array.isArray(hit)) return hit as readonly unknown[];
  if (depth >= MAX_ROW_DEPTH || level.length === 0) return [];
  const deeper = descend(level);
  return findRowArray(deeper, depth + 1);
}

/**
 * Union the field names carried by the sampled rows.
 * @param rows - Candidate collection.
 * @returns Sorted, bounded field names — never any field value.
 */
function unionRowKeys(rows: readonly unknown[]): readonly string[] {
  const sampled = rows.slice(0, MAX_ROW_SAMPLE).filter(isPlainRecord);
  const allNames = sampled.flatMap(row => Object.keys(row));
  const safeNames = allNames.filter(isSchemaKey);
  const unique = new Set(safeNames);
  const sorted = [...unique].sort((a, b) => a.localeCompare(b));
  return sorted.slice(0, MAX_ROW_KEYS);
}

/**
 * Narrow an already-parsed value to a top-level record, rejecting
 * arrays and scalars so field reads stay meaningful.
 * @param parsed - Value produced by JSON.parse.
 * @returns Top-level record (empty when not a plain object).
 */
function coerceRecord(parsed: unknown): Record<string, unknown> {
  return isPlainRecord(parsed) ? parsed : {};
}

/**
 * Parse a body, tolerating non-JSON payloads such as HTML error pages.
 * @param bodyText - Raw response text.
 * @returns Parsed value; an empty record when the body is not JSON.
 */
function parseUnknown(bodyText: string): unknown {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed;
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
 * Field names of the first collection found anywhere in the body.
 * @param parsed - Parsed body, of any shape.
 * @returns Sorted, bounded field names; empty when no collection exists.
 */
function rowKeysOf(parsed: unknown): readonly string[] {
  const rows = findRowArray([parsed], 0);
  return unionRowKeys(rows);
}

/**
 * Read the envelope's rejection fields.
 * @param top - Parsed top-level record.
 * @returns Error code and name; empty strings when absent.
 */
function errorFields(
  top: Record<string, unknown>,
): Pick<IResponseDigest, 'errorCode' | 'errorName'> {
  return { errorCode: stringField(top, 'code'), errorName: stringField(top, 'name') };
}

/**
 * Summarise a response body for logging without emitting any value that
 * could carry customer data.
 * @param bodyText - Raw response text.
 * @returns Digest safe to emit at DEBUG level.
 */
export function digestResponse(bodyText: string): IResponseDigest {
  const parsed = parseUnknown(bodyText);
  const top = coerceRecord(parsed);
  return {
    respLength: Buffer.byteLength(bodyText, 'utf8'),
    respKeys: Object.keys(top),
    rowKeys: rowKeysOf(parsed),
    ...errorFields(top),
  };
}
