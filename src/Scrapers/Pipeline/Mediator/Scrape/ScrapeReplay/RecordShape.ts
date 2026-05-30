/**
 * Shape-aware substitution into a captured POST body: account-record
 * scalar fields, WK month/year (composite or paired keys), and
 * monthly-endpoint detection. Used to build per-month POST bodies
 * from a captured template.
 */

import { PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF } from '../../../Registry/WK/ScrapeWK.js';
import type { JsonNode } from '../JsonTraversal.js';
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
 * Substitutes `ctx.body[bk]` with the matching scalar from `ctx.record`,
 * unless `bk` is reserved for WK monthly substitution.
 * @param ctx - bundled shape context.
 * @param bk - body key under consideration.
 * @returns True when a substitution was applied.
 */
function applyShapeForKey(ctx: IShapeStepCtx, bk: string): boolean {
  const lowerBk = bk.toLowerCase();
  if (ctx.skipKeys.has(lowerBk)) return false;
  const hit = findScalarShapeHit(ctx, bk);
  if (!hit) return false;
  const before = ctx.body[bk];
  ctx.body[bk] = coerceToBodyType(before, hit.recVal);
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
 * Pick the composite-date key index from a body's lowercased keys.
 * @param bodyKeys - Body keys.
 * @returns Match info or false.
 */
function pickComposite(bodyKeys: readonly string[]): { lower: string } | false {
  const lowerKeys = bodyKeys.map((k): string => k.toLowerCase());
  const lowerComposite = MF.compositeDate.map((f): string => f.toLowerCase());
  const hit = lowerComposite.find((lf): boolean => lowerKeys.includes(lf));
  if (!hit) return false;
  return { lower: hit };
}

/**
 * Check if the body has a composite date field (DD/MM/YYYY format).
 * Uses WK MONTHLY_FIELDS.compositeDate for detection — no hardcoded keys.
 * @param body - Parsed POST body.
 * @returns The matched composite field key, or false.
 */
function findCompositeField(body: JsonRecord): string | false {
  const bodyKeys = Object.keys(body);
  const pick = pickComposite(bodyKeys);
  if (!pick) return false;
  const lowerKeys = bodyKeys.map((k): string => k.toLowerCase());
  return bodyKeys[lowerKeys.indexOf(pick.lower)];
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
 * Build a POST body for one month from a template.
 * @param opts - Month body options with template + values.
 * @returns New POST body as Record.
 */
function buildMonthBody(opts: IMonthBodyOpts): JsonRecord {
  const body = JSON.parse(opts.template) as JsonRecord;
  replaceField(body, MF.accountId, opts.accountId);
  applyMonthYear(body, opts.month, opts.year);
  if (opts.accountRecord) {
    applyRecordShape(body, opts.accountRecord, RESERVED_WK_KEYS);
  }
  return body;
}

/**
 * Safe JSON parse — returns parsed object or false on failure.
 * @param raw - Raw JSON string.
 * @returns Parsed object or false.
 */
function safeParse(raw: string): JsonRecord | false {
  try {
    return JSON.parse(raw) as JsonRecord;
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
  const body = safeParse(postData);
  if (!body) return false;
  const hasMonth = MF.month.some((f): boolean => f in body);
  const hasYear = MF.year.some((f): boolean => f in body);
  if (hasMonth && hasYear) return true;
  return findCompositeField(body) !== false;
}

export { buildMonthBody, isMonthlyEndpoint };
