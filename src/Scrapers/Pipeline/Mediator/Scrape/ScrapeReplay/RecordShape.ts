/**
 * Shape-aware substitution into a captured POST body: account-record
 * scalar fields, WK month/year (composite or paired keys), and
 * monthly-endpoint detection. Used to build per-month POST bodies
 * from a captured template.
 */

import { PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF } from '../../../Registry/WK/ScrapeWK.js';
import type { JsonNode } from '../JsonTraversal.js';
import type { IDateBounds } from './BodyDateRange.js';
import { applyDateRangeToBody, isDateRangeBody } from './BodyDateRange.js';
import replaceField from './JsonReplace.js';
import type { JsonRecord } from './JsonTypes.js';

/**
 * Account record passed through buildMonthBody for shape-aware
 * substitution. Values are `unknown` because the record originates from
 * `JSON.parse` (or a captured-traffic body); applyRecordShape only acts
 * on scalar values, so the wider type accommodates banks whose responses
 * include nested objects/arrays under non-scalar keys.
 */
type AccountRecordShape = Readonly<Record<string, unknown>>;

/** Scalar value safely substitutable into a JSON body. */
type ScalarValue = string | number | boolean;

/** Options for building a monthly POST body. */
interface IMonthBodyOpts {
  readonly template: string;
  readonly accountId: string;
  readonly month: number;
  readonly year: number;
  /**
   * Per-card account record used for shape-aware substitution. Any
   * scalar field whose name matches a body key (case-insensitive) is
   * copied into the body, preserving the body value's primitive type.
   */
  readonly accountRecord?: AccountRecordShape;
}

/** Matched body key paired with the scalar value to substitute. */
interface IShapeHit {
  readonly bodyKey: string;
  readonly recVal: ScalarValue;
}

/** Bundled context for one shape-substitution attempt. */
interface IShapeStepCtx {
  readonly body: JsonRecord;
  readonly record: AccountRecordShape;
  readonly recordKeys: readonly string[];
  readonly skipKeys: ReadonlySet<string>;
}

/**
 * Lowercase set of WK keys reserved for monthly substitution. Lets
 * applyRecordShape skip them so it doesn't fight buildMonthBody.
 */
const RESERVED_WK_KEYS: ReadonlySet<string> = new Set(
  [...MF.accountId, ...MF.month, ...MF.year, ...MF.compositeDate].map((k): string =>
    k.toLowerCase(),
  ),
);

/**
 * Returns `recVal` cast to the same primitive type as `bodyVal`, so the
 * substitution preserves the wire format the bank originally received.
 * @param bodyVal - original value in the body (sets the target type).
 * @param recVal - scalar value from the account record.
 * @returns coerced JsonNode of the same primitive shape as bodyVal.
 */
function coerceToBodyType(bodyVal: JsonNode, recVal: ScalarValue): JsonNode {
  if (typeof bodyVal === 'number' && typeof recVal === 'string') return Number(recVal);
  if (typeof bodyVal === 'string' && typeof recVal === 'number') return String(recVal);
  if (typeof bodyVal === 'boolean' && typeof recVal !== 'boolean') return Boolean(recVal);
  return recVal;
}

/**
 * Type guard for values that are safe to inline into a JSON body.
 * @param v - candidate value from an AccountRecordShape entry.
 * @returns true when v is string, number, or boolean.
 */
function isScalar(v: AccountRecordShape[string]): v is ScalarValue {
  if (typeof v === 'string') return true;
  if (typeof v === 'number') return true;
  return typeof v === 'boolean';
}

/**
 * Find the record key matching `bodyKey` case-insensitively.
 * @param recordKeys - account record keys.
 * @param bodyKey - target body key.
 * @returns Matching record key or false.
 */
function findRecordKey(recordKeys: readonly string[], bodyKey: string): string | false {
  const lowerBody = bodyKey.toLowerCase();
  const found = recordKeys.find((k): boolean => k.toLowerCase() === lowerBody);
  return found ?? false;
}

/**
 * Returns the scalar value for `bodyKey` from `ctx.record`, or false
 * when no key matches or the value is non-scalar.
 * @param ctx - shape step context.
 * @param bodyKey - target body key.
 * @returns scalar hit, or false.
 */
function findScalarShapeHit(ctx: IShapeStepCtx, bodyKey: string): IShapeHit | false {
  const rk = findRecordKey(ctx.recordKeys, bodyKey);
  if (rk === false) return false;
  const recVal = ctx.record[rk];
  if (!isScalar(recVal)) return false;
  return { bodyKey, recVal };
}

/**
 * True when `v` is a structural type-version sentinel — a `*_<major>.<minor>.<patch>`
 * tag such as `MessageEnvelope_1.0.0`.
 *
 * <p>These tags discriminate the envelope/record TYPE on the wire and must never
 * be overwritten by a per-card account-record field that happens to share the
 * body key (e.g. a record carrying its own `Ver` of a different type). Skipping
 * them keeps the replayed body's structural type identical to the captured
 * template. The regex is end-anchored with no nested quantifier (ReDoS-safe).
 * @param v - candidate body value.
 * @returns true when v is a string ending in `_<digits>.<digits>.<digits>`.
 */
function isVersionSentinel(v: JsonNode): boolean {
  return typeof v === 'string' && /_\d+\.\d+\.\d+$/.test(v);
}

/**
 * Substitutes `ctx.body[bk]` with the matching scalar from `ctx.record`,
 * unless `bk` is reserved for WK monthly substitution or holds a structural
 * type-version sentinel.
 * @param ctx - bundled shape context.
 * @param bk - body key under consideration.
 * @returns True when a substitution was applied.
 */
function applyShapeForKey(ctx: IShapeStepCtx, bk: string): boolean {
  const lowerBk = bk.toLowerCase();
  if (ctx.skipKeys.has(lowerBk) || isVersionSentinel(ctx.body[bk])) return false;
  const hit = findScalarShapeHit(ctx, bk);
  if (!hit) return false;
  ctx.body[bk] = coerceToBodyType(ctx.body[bk], hit.recVal);
  return true;
}

/**
 * Shape-aware substitution: copy any scalar field from accountRecord
 * into body where keys match (case-insensitive). Skips composite-date
 * and WK-monthly fields — those are handled by buildMonthBody.
 * @param body - Body to mutate.
 * @param record - Account record (values may be any JSON shape).
 * @param skipKeys - Body keys reserved for WK substitution.
 * @returns True after applying.
 */
function applyRecordShape(
  body: JsonRecord,
  record: AccountRecordShape,
  skipKeys: ReadonlySet<string>,
): true {
  const recordKeys = Object.keys(record);
  const ctx: IShapeStepCtx = { body, record, recordKeys, skipKeys };
  for (const bk of Object.keys(body)) applyShapeForKey(ctx, bk);
  return true;
}

/**
 * Pick the composite-date body key from a body's keys.
 *
 * <p>Returns the ORIGINAL body key (preserving casing) so callers may use it
 * directly. Returning the body key (not just its lowercase form) collapses
 * the previous double-search in `findCompositeField` and removes the
 * unreachable `?? false` defensive guard (the second `.find()` was provably
 * always defined per the lookup invariant).
 *
 * @param bodyKeys - Body keys.
 * @returns Matched body key or false.
 */
function pickComposite(bodyKeys: readonly string[]): string | false {
  const lowerCompositeSet = new Set(MF.compositeDate.map((f): string => f.toLowerCase()));
  return bodyKeys.find((k): boolean => lowerCompositeSet.has(k.toLowerCase())) ?? false;
}

/**
 * Check if the body has a composite date field (DD/MM/YYYY format).
 * Uses WK MONTHLY_FIELDS.compositeDate for detection — no hardcoded keys.
 * @param body - Parsed POST body.
 * @returns The matched composite field key, or false.
 */
function findCompositeField(body: JsonRecord): string | false {
  return pickComposite(Object.keys(body));
}

/**
 * Bundled args for month/year substitution.
 */
interface IMonthYearArgs {
  readonly body: JsonRecord;
  readonly month: number;
  readonly year: number;
}

/** Bundled args for composite (DD/MM/YYYY) substitution. */
interface ICompositeArgs extends IMonthYearArgs {
  readonly key: string;
}

/**
 * Apply DD/MM/YYYY composite-date substitution.
 * @param args - body + month + year + composite key.
 * @returns True after apply.
 */
function applyCompositeDate(args: ICompositeArgs): true {
  const mm = String(args.month).padStart(2, '0');
  const yr = String(args.year);
  args.body[args.key] = `01/${mm}/${yr}`;
  return true;
}

/**
 * Apply paired month/year WK substitution to a body.
 * @param args - body + month + year.
 * @returns True after apply.
 */
function applyDirectMonthYear(args: IMonthYearArgs): true {
  const monthStr = String(args.month);
  const yearStr = String(args.year);
  replaceField(args.body, MF.month, monthStr);
  replaceField(args.body, MF.year, yearStr);
  return true;
}

/**
 * Apply month/year substitution — composite (DD/MM/YYYY) when the body
 * carries one of WK.compositeDate; otherwise individual month/year keys.
 * @param body - Body to mutate.
 * @param month - Calendar month (1-indexed).
 * @param year - Calendar year.
 * @returns True after apply.
 */
function applyMonthYear(body: JsonRecord, month: number, year: number): true {
  const compositeKey = findCompositeField(body);
  if (compositeKey) {
    return applyCompositeDate({ body, month, year, key: compositeKey });
  }
  return applyDirectMonthYear({ body, month, year });
}

/**
 * First-day/last-day bounds for a calendar month (1-indexed).
 * @param month - Calendar month, 1-indexed (1 = January).
 * @param year - Full calendar year.
 * @returns Inclusive { from, to } Date bounds for the month.
 */
function monthBounds(month: number, year: number): IDateBounds {
  return { from: new Date(year, month - 1, 1), to: new Date(year, month, 0) };
}

/**
 * Apply the per-month window: a nested from/to date-range body gets its
 * GE/LE bounds rewritten; a top-level month/year body gets month/year keys.
 * @param body - Body to mutate.
 * @param opts - Month body options (template + month + year).
 */
function applyDates(body: JsonRecord, opts: IMonthBodyOpts): void {
  if (isDateRangeBody(opts.template)) {
    applyDateRangeToBody(body, monthBounds(opts.month, opts.year));
    return;
  }
  applyMonthYear(body, opts.month, opts.year);
}

/**
 * Build a POST body for one month from a template.
 * @param opts - Month body options with template + values.
 * @returns New POST body as Record.
 */
function buildMonthBody(opts: IMonthBodyOpts): JsonRecord {
  const body = JSON.parse(opts.template) as JsonRecord;
  replaceField(body, MF.accountId, opts.accountId);
  applyDates(body, opts);
  if (opts.accountRecord) {
    applyRecordShape(body, opts.accountRecord, RESERVED_WK_KEYS);
  }
  return body;
}

/**
 * Type-guard a parsed JSON value as a plain record. Rejects
 * primitives (number/string/bool/null) and arrays so `in` operator
 * downstream never throws TypeError. CR#281/CR-2.
 *
 * @param v - Value returned from `JSON.parse`.
 * @returns True when value is a plain object record.
 */
function isJsonRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Safe JSON parse — returns plain-object record or false on failure
 * (parse error, or parsed value is not a plain object).
 * @param raw - Raw JSON string.
 * @returns Parsed record or false.
 */
function safeParse(raw: string): JsonRecord | false {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonRecord(parsed) ? parsed : false;
  } catch {
    return false;
  }
}

/**
 * Check if a captured POST body uses monthly iteration.
 * @param postData - Captured POST body string.
 * @returns True if the endpoint uses monthly fetching.
 */
function isMonthlyEndpoint(postData: string): boolean {
  if (!postData) return false;
  if (isDateRangeBody(postData)) return true;
  const body = safeParse(postData);
  if (!body) return false;
  const hasMonth = MF.month.some((f): boolean => f in body);
  const hasYear = MF.year.some((f): boolean => f in body);
  if (hasMonth && hasYear) return true;
  return findCompositeField(body) !== false;
}

export { buildMonthBody, isMonthlyEndpoint };
