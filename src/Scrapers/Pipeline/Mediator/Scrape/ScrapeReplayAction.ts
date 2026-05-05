/**
 * POST body templating — replace WellKnown fields + monthly chunks.
 * Used by ScrapePhase to iterate over accounts and date ranges.
 */

import {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../Registry/WK/ScrapeWK.js';
import type { JsonNode } from './JsonTraversal.js';

/** A dynamic JSON record from parsed API responses. */
type JsonRecord = Record<string, JsonNode>;

/** Max depth for iterative replaceField BFS. */
const MAX_REPLACE_DEPTH = 15;

/** Whether a value is a searchable object (not null, not array). */
type IsSearchable = boolean;
/** Whether a replaceField operation mutated the target body. */
type DidReplace = boolean;
/** Whether a POST body uses monthly date pagination. */
type IsMonthly = boolean;
/** Whether a POST body has date range (from/to) fields. */
type IsIterable = boolean;
/** Lowercased field key from POST body for WK matching. */
type BodyKey = string;
/** Raw POST body template string. */
type PostTemplate = string;
/** Account ID string used in billing POST body. */
type AccountIdStr = string;
/** Calendar month number (1-indexed). */
type MonthNum = number;
/** Calendar year number. */
type YearNum = number;
/** Epoch milliseconds timestamp. */
type EpochMs = number;
/** ISO start date string for a month chunk. */
type ChunkStart = string;
/** ISO end date string for a month chunk. */
type ChunkEnd = string;
/** Formatted YYYY-MM-DD date string. */
type DatePartStr = string;

/**
 * Check if a value is a searchable object (not null, not array).
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObj(val: JsonNode): IsSearchable {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Try to replace a WK field in a single object.
 * @param obj - Object to check and mutate.
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if a field was replaced.
 */
function replaceInObject(
  obj: JsonRecord,
  fieldNames: readonly string[],
  value: PostTemplate,
): DidReplace {
  const keys = Object.keys(obj);
  const lowerKeys = keys.map((k): BodyKey => k.toLowerCase());
  const hit = fieldNames.find((f): IsSearchable => {
    const lowerF = f.toLowerCase();
    return lowerKeys.includes(lowerF);
  });
  if (!hit) return false;
  const lowerHit = hit.toLowerCase();
  const idx = lowerKeys.indexOf(lowerHit);
  const bodyKey = keys[idx];
  obj[bodyKey] = value;
  return true;
}

/**
 * Collect searchable child objects from an array.
 * @param arr - Array to filter for objects.
 * @returns Searchable objects from the array.
 */
function collectArrayObjs(arr: readonly JsonNode[]): JsonRecord[] {
  return arr
    .filter((item): IsSearchable => isSearchableObj(item))
    .map((item): JsonRecord => item as JsonRecord);
}

/**
 * Collect child objects from one value (array or object).
 * @param child - Value to inspect.
 * @returns Array of child objects for BFS.
 */
function collectChildObjs(child: JsonNode): JsonRecord[] {
  if (Array.isArray(child)) return collectArrayObjs(child);
  if (isSearchableObj(child)) {
    return [child as JsonRecord];
  }
  return [];
}

/**
 * Collect all child objects from a record for BFS.
 * @param obj - Parent object.
 * @returns Array of child objects for next BFS level.
 */
function collectBfsChildren(obj: JsonRecord): JsonRecord[] {
  const vals = Object.values(obj);
  return vals.flatMap((v): JsonRecord[] => collectChildObjs(v));
}

/**
 * Process one BFS level: replace fields + collect children.
 * @param queue - Current level objects.
 * @param fieldNames - WellKnown field names.
 * @param value - Replacement value.
 * @returns Replace status and next queue.
 */
function processReplaceLevel(
  queue: JsonRecord[],
  fieldNames: readonly string[],
  value: PostTemplate,
): { didReplace: DidReplace; next: JsonRecord[] } {
  let didReplace = false;
  const next: JsonRecord[] = [];
  for (const obj of queue) {
    const wasReplaced = replaceInObject(obj, fieldNames, value);
    didReplace = didReplace || wasReplaced;
    next.push(...collectBfsChildren(obj));
  }
  return { didReplace, next };
}

/**
 * Replace a WellKnown field in a body (iterative BFS).
 * @param body - Object to replace in (mutated).
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if at least one field was replaced.
 */
/** Bundled BFS replace context. */
interface IBfsReplaceCtx {
  readonly fieldNames: readonly string[];
  readonly value: PostTemplate;
}

/**
 * Recursive BFS replace — processes one level then recurses.
 * @param queue - Current level objects.
 * @param ctx - Replace context.
 * @param depth - Current depth.
 * @returns True if any field was replaced.
 */
function replaceBfsLevel(queue: JsonRecord[], ctx: IBfsReplaceCtx, depth: number): DidReplace {
  if (queue.length === 0 || depth >= MAX_REPLACE_DEPTH) return false;
  const level = processReplaceLevel(queue, ctx.fieldNames, ctx.value);
  if (level.didReplace) return true;
  return replaceBfsLevel(level.next, ctx, depth + 1);
}

/**
 * Replace a WellKnown field in a body (recursive BFS).
 * @param body - Object to replace in (mutated).
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if at least one field was replaced.
 */
function replaceField(
  body: JsonRecord,
  fieldNames: readonly string[],
  value: PostTemplate,
): DidReplace {
  const didReplaceDirect = replaceBfsLevel([body], { fieldNames, value }, 0);
  if (didReplaceDirect) return true;
  return replaceFieldInBase64Context(body, fieldNames, value);
}

/**
 * Try replacing a field inside a Base64-encoded paging context.
 * @param body - Object containing potential Base64 field.
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if replaced inside decoded context.
 */
function replaceFieldInBase64Context(
  body: JsonRecord,
  fieldNames: readonly string[],
  value: PostTemplate,
): DidReplace {
  const ctx = findPagingContext(body);
  if (!ctx) return false;
  const didReplace = replaceBfsLevel([ctx.decoded], { fieldNames, value }, 0);
  if (!didReplace) return false;
  body[ctx.key] = encodeToBase64(ctx.decoded);
  return true;
}

/**
 * Account record passed through buildMonthBody for shape-aware
 * substitution. Values are `unknown` because the record originates from
 * `JSON.parse` (or a captured-traffic body); applyRecordShape only acts
 * on scalar values, so the wider type is safe and accommodates banks
 * whose responses include nested objects/arrays under non-scalar keys.
 */
type AccountRecordShape = Readonly<Record<string, unknown>>;

/** Options for building a monthly POST body. */
interface IMonthBodyOpts {
  readonly template: PostTemplate;
  readonly accountId: AccountIdStr;
  readonly month: MonthNum;
  readonly year: YearNum;
  /**
   * Per-card account record used for shape-aware substitution. Any
   * scalar field whose name matches a body key (case-insensitive) is
   * copied into the body, preserving the body value's primitive type.
   * Generic — handles per-card fields like companyCode, cardStatus,
   * isPartner without bank-specific code.
   */
  readonly accountRecord?: AccountRecordShape;
}

/** Scalar value safely substitutable into a JSON body. */
type ScalarValue = string | number | boolean;

/**
 * Returns `recVal` cast to the same primitive type as `bodyVal`, so the
 * substitution preserves the wire format the bank originally received
 * (a number stays numeric, a boolean stays boolean, etc.).
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

/** Matched body key paired with the scalar value to substitute. */
interface IShapeHit {
  readonly bodyKey: BodyKey;
  readonly recVal: ScalarValue;
}

/**
 * Returns the scalar value for `bodyKey` from `record` (case-insensitive
 * key match), or false when no key matches or the value is non-scalar.
 * Non-scalar values are skipped so existing nested objects in the body
 * survive untouched.
 * @param record - account record.
 * @param recordKeys - pre-computed record keys.
 * @param bodyKey - target body key.
 * @returns scalar hit, or false.
 */
function findScalarShapeHit(
  record: AccountRecordShape,
  recordKeys: readonly string[],
  bodyKey: BodyKey,
): IShapeHit | false {
  const lowerBody = bodyKey.toLowerCase();
  const rk = recordKeys.find((k): DidReplace => k.toLowerCase() === lowerBody);
  if (!rk) return false;
  const recVal = record[rk];
  if (!isScalar(recVal)) return false;
  return { bodyKey, recVal };
}

/** Bundled context for one shape-substitution attempt. */
interface IShapeStepCtx {
  readonly body: JsonRecord;
  readonly record: AccountRecordShape;
  readonly recordKeys: readonly string[];
  readonly skipKeys: ReadonlySet<string>;
}

/**
 * Substitutes `body[bk]` with the matching scalar from `ctx.record`,
 * unless `bk` is reserved for WK monthly substitution.
 * @param ctx - bundled shape context.
 * @param bk - body key under consideration.
 * @returns true (sentinel — Rule #15 forbids void).
 */
function applyShapeForKey(ctx: IShapeStepCtx, bk: BodyKey): true {
  const lowerBk = bk.toLowerCase();
  if (ctx.skipKeys.has(lowerBk)) return true;
  const hit = findScalarShapeHit(ctx.record, ctx.recordKeys, bk);
  if (!hit) return true;
  const before = ctx.body[bk];
  ctx.body[bk] = coerceToBodyType(before, hit.recVal);
  return true;
}

/**
 * Shape-aware substitution: copy any scalar field from accountRecord
 * into body where keys match (case-insensitive). Fills per-card body
 * fields (companyCode, cardStatus, isPartner) without bank-specific
 * knowledge. Mutates `body` in place. Skips composite-date and
 * WK-monthly fields — those are handled by buildMonthBody.
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
 * Lowercase set of WK keys reserved for monthly substitution. Lets
 * applyRecordShape skip them so it doesn't fight buildMonthBody.
 */
const RESERVED_WK_KEYS: ReadonlySet<string> = new Set(
  [...MF.accountId, ...MF.month, ...MF.year, ...MF.compositeDate].map(
    (k): BodyKey => k.toLowerCase(),
  ),
);

/**
 * Check if the body has a composite date field (DD/MM/YYYY format).
 * Uses WK MONTHLY_FIELDS.compositeDate for detection — no hardcoded keys.
 * @param body - Parsed POST body.
 * @returns The matched composite field key, or false.
 */
function findCompositeField(body: JsonRecord): string | false {
  const bodyKeys = Object.keys(body);
  const lowerBodyKeys = bodyKeys.map((k): BodyKey => k.toLowerCase());
  const compositeFields = MF.compositeDate;
  const lowerComposite = compositeFields.map((f): BodyKey => f.toLowerCase());
  const hitIdx = lowerComposite.findIndex((lf): IsSearchable => lowerBodyKeys.includes(lf));
  if (hitIdx < 0) return false;
  const matchedLower = lowerComposite[hitIdx];
  const bodyIdx = lowerBodyKeys.indexOf(matchedLower);
  return bodyKeys[bodyIdx];
}

/**
 * Apply month/year substitution — composite (DD/MM/YYYY) when the body
 * carries one of WK.compositeDate; otherwise individual month/year keys.
 * @param body - Body to mutate.
 * @param month - Calendar month (1-indexed).
 * @param year - Calendar year.
 * @returns True after apply.
 */
function applyMonthYear(body: JsonRecord, month: MonthNum, year: YearNum): true {
  const compositeKey = findCompositeField(body);
  if (compositeKey) {
    const mm = String(month).padStart(2, '0');
    const yr = String(year);
    body[compositeKey] = `01/${mm}/${yr}`;
    return true;
  }
  const monthStr = String(month);
  const yearStr = String(year);
  replaceField(body, MF.month, monthStr);
  replaceField(body, MF.year, yearStr);
  return true;
}

/**
 * Build a POST body for one month from a template.
 * Uses WK MONTHLY_FIELDS to replace account, month, and year fields.
 * Handles composite date fields (DD/MM/YYYY) via WK.compositeDate detection.
 * Optionally applies shape-aware substitution from `accountRecord` so
 * per-card fields (companyCode, cardStatus, isPartner, …) reflect the
 * iterated card rather than carrying through from the captured template.
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
 * Check if a captured POST body uses monthly iteration.
 * @param postData - Captured POST body string.
 * @returns True if the endpoint uses monthly fetching.
 */
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
function isMonthlyEndpoint(postData: PostTemplate): IsMonthly {
  if (!postData) return false;
  const body = safeParse(postData);
  if (!body) return false;
  const hasMonth = MF.month.some((f): IsMonthly => f in body);
  const hasYear = MF.year.some((f): IsMonthly => f in body);
  if (hasMonth && hasYear) return true;
  // Composite date (DD/MM/YYYY) encodes both month+year in one field
  return findCompositeField(body) !== false;
}

// ── Base64 Paging Context Support ─────────────────────────────────

/** Whether a value looks like Base64-encoded JSON. */
type IsBase64 = boolean;
/** Decoded Base64 JSON key. */
type PagingKey = string;

/** Known paging context field names (case-insensitive). */
const PAGING_CONTEXT_KEYS = [
  'pagingcontext',
  'pagingContext',
  'pageContext',
  'pagecontext',
] as const;

/**
 * Try decoding a Base64-encoded JSON string.
 * @param encoded - Potential Base64 string.
 * @returns Parsed object or false.
 */
function tryDecodeBase64(encoded: string): JsonRecord | false {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as JsonRecord;
  } catch {
    return false;
  }
}

/**
 * Re-encode a JSON object to Base64.
 * @param obj - Object to encode.
 * @returns Base64-encoded string.
 */
function encodeToBase64(obj: JsonRecord): PostTemplate {
  const jsonStr = JSON.stringify(obj);
  return Buffer.from(jsonStr, 'utf-8').toString('base64');
}

/** Result of paging context lookup. */
interface IPagingContextHit {
  readonly key: PagingKey;
  readonly decoded: JsonRecord;
}

/**
 * Check if a single body key is a paging context with Base64 JSON.
 * @param body - Parsed POST body.
 * @param bk - Body key to check.
 * @returns Decoded context or false.
 */
function tryPagingKey(body: JsonRecord, bk: PagingKey): IPagingContextHit | false {
  const lowerBk = bk.toLowerCase();
  const isKnown: IsBase64 = PAGING_CONTEXT_KEYS.some(
    (pk): IsBase64 => pk.toLowerCase() === lowerBk,
  );
  if (!isKnown) return false;
  const val = body[bk];
  if (typeof val !== 'string') return false;
  const decoded = tryDecodeBase64(val);
  if (!decoded) return false;
  return { key: bk, decoded };
}

/**
 * Find a paging context field in the body.
 * @param body - Parsed POST body.
 * @returns Key name and decoded content, or false.
 */
function findPagingContext(body: JsonRecord): IPagingContextHit | false {
  const bodyKeys = Object.keys(body);
  const hits = bodyKeys.map((bk): IPagingContextHit | false => tryPagingKey(body, bk));
  const firstHit = hits.find((h): h is IPagingContextHit => h !== false);
  return firstHit ?? false;
}

/**
 * Check if date range fields exist in direct body or Base64 context.
 * @param body - Parsed POST body.
 * @returns True if from+to WK fields found (direct or encoded).
 */
function hasDateRangeFields(body: JsonRecord): IsIterable {
  const lowerKeys = Object.keys(body).map((k): BodyKey => k.toLowerCase());
  const keys = new Set(lowerKeys);
  const lowerFrom = WK.fromDate.map((f): BodyKey => f.toLowerCase());
  const lowerTo = WK.toDate.map((f): BodyKey => f.toLowerCase());
  const hasFrom = lowerFrom.some((f): IsIterable => keys.has(f));
  const hasTo = lowerTo.some((f): IsIterable => keys.has(f));
  return hasFrom && hasTo;
}

/**
 * Check if a POST body has date range fields.
 * Searches direct body + Base64-encoded paging context.
 * @param body - Parsed POST body.
 * @returns True if both from and to WK fields are present.
 */
function isRangeIterable(body: JsonRecord): IsIterable {
  if (hasDateRangeFields(body)) return true;
  const ctx = findPagingContext(body);
  if (!ctx) return false;
  return hasDateRangeFields(ctx.decoded);
}

/** A single month chunk with start and end ISO strings. */
interface IMonthChunk {
  readonly start: ChunkStart;
  readonly end: ChunkEnd;
}

/**
 * Format a date as YYYY-MM-DD.
 * @param d - Date to format.
 * @returns Formatted date string.
 */
function formatDatePart(d: Date): DatePartStr {
  const fullYear = d.getFullYear();
  const monthIdx = d.getMonth() + 1;
  const y = String(fullYear);
  const m = String(monthIdx).padStart(2, '0');
  const dayNum = d.getDate();
  const day = String(dayNum).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Advance year/month by one, wrapping at December.
 * @param year - Current year.
 * @param month - Current month (0-indexed).
 * @returns Next year and month.
 */
function advanceMonth(year: YearNum, month: MonthNum): { year: YearNum; month: MonthNum } {
  const next = month + 1;
  if (next > 11) return { year: year + 1, month: 0 };
  return { year, month: next };
}

/**
 * Build one month chunk with start/end ISO timestamps.
 * @param year - Chunk year.
 * @param month - Chunk month (0-indexed).
 * @param endTime - Max end time in ms.
 * @returns Month chunk.
 */
function buildChunk(year: number, month: number, endTime: number): IMonthChunk {
  const pad = String(month + 1).padStart(2, '0');
  const firstDay = `${String(year)}-${pad}-01`;
  const lastDayDate = new Date(year, month + 1, 0);
  const lastDayMs = lastDayDate.getTime();
  const chunkEndMs = Math.min(lastDayMs, endTime);
  const endDay = formatDatePart(new Date(chunkEndMs));
  return {
    start: `${firstDay}T00:00:00.000Z`,
    end: `${endDay}T23:59:59.000Z`,
  };
}

/**
 * Generate monthly date chunks from start to end.
 * @param start - Range start date.
 * @param end - Range end date (capped to today).
 * @returns Array of month chunks with ISO timestamps.
 */
interface IChunkBuildState {
  readonly year: YearNum;
  readonly month: MonthNum;
  readonly endTime: EpochMs;
}

/**
 * Recursively build month chunks until end date.
 * @param state - Current year/month/endTime.
 * @param accumulated - Chunks collected so far.
 * @returns Complete chunk list.
 */
function buildChunkList(
  state: IChunkBuildState,
  accumulated: IMonthChunk[],
): readonly IMonthChunk[] {
  const currentMs = new Date(state.year, state.month, 1).getTime();
  if (currentMs > state.endTime) return accumulated;
  const chunk = buildChunk(state.year, state.month, state.endTime);
  const next = advanceMonth(state.year, state.month);
  const nextState: IChunkBuildState = {
    year: next.year,
    month: next.month,
    endTime: state.endTime,
  };
  return buildChunkList(nextState, [...accumulated, chunk]);
}

/**
 * Compute the effective end date — extend by futureMonths or cap to today.
 * @param end - Requested end date.
 * @param futureMonths - Extra billing months beyond today.
 * @returns Resolved end date.
 */
function resolveEndDate(end: Date, futureMonths?: number): Date {
  const today = new Date();
  if (futureMonths && futureMonths > 0) {
    const future = new Date(today);
    future.setMonth(future.getMonth() + futureMonths);
    return future;
  }
  const isFuture = end > today;
  const capMap: Record<string, Date> = { true: today, false: end };
  return capMap[String(isFuture)];
}

/**
 * Generate monthly chunks for a date range.
 * @param start - Range start date.
 * @param end - Range end date (capped to today unless futureMonths).
 * @param futureMonths - Extra billing months beyond today.
 * @returns Array of month chunks.
 */
function generateMonthChunks(
  start: Date,
  end: Date,
  futureMonths?: number,
): readonly IMonthChunk[] {
  const cappedEnd = resolveEndDate(end, futureMonths);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const endTime = cappedEnd.getTime();
  return buildChunkList({ year: startYear, month: startMonth, endTime }, []);
}

export type { IMonthChunk, JsonRecord };
export { buildMonthBody, generateMonthChunks, isMonthlyEndpoint, isRangeIterable, replaceField };
