/**
 * POST body templating — replace WellKnown fields + monthly chunks.
 * Used by ScrapePhase to iterate over accounts and date ranges.
 */

import {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../Registry/WK/ScrapeWK.js';
import type { JsonNode } from '../../Strategy/Scrape/JsonTraversalStrategy.js';

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
  return replaceBfsLevel([body], { fieldNames, value }, 0);
}

/** Options for building a monthly POST body. */
interface IMonthBodyOpts {
  readonly template: PostTemplate;
  readonly accountId: AccountIdStr;
  readonly month: MonthNum;
  readonly year: YearNum;
}

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
 * Build a POST body for one month from a template.
 * Uses WK MONTHLY_FIELDS to replace account, month, and year fields.
 * Handles composite date fields (DD/MM/YYYY) via WK.compositeDate detection.
 * @param opts - Month body options with template + values.
 * @returns New POST body as Record.
 */
function buildMonthBody(opts: IMonthBodyOpts): JsonRecord {
  const body = JSON.parse(opts.template) as JsonRecord;
  replaceField(body, MF.accountId, opts.accountId);
  const compositeKey = findCompositeField(body);
  if (compositeKey) {
    const mm = String(opts.month).padStart(2, '0');
    const yr = String(opts.year);
    body[compositeKey] = `01/${mm}/${yr}`;
    return body;
  }
  const monthStr = String(opts.month);
  const yearStr = String(opts.year);
  replaceField(body, MF.month, monthStr);
  replaceField(body, MF.year, yearStr);
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

/**
 * Check if a POST body has date range fields.
 * @param body - Parsed POST body.
 * @returns True if both from and to WK fields are present.
 */
function isRangeIterable(body: JsonRecord): IsIterable {
  const lowerKeys = Object.keys(body).map((k): BodyKey => k.toLowerCase());
  const keys = new Set(lowerKeys);
  const hasFrom = WK.fromDate.some((f): IsIterable => {
    const lowerF = f.toLowerCase();
    return keys.has(lowerF);
  });
  const hasTo = WK.toDate.some((f): IsIterable => {
    const lowerF = f.toLowerCase();
    return keys.has(lowerF);
  });
  return hasFrom && hasTo;
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
 * Generate monthly chunks for a date range.
 * @param start - Range start date.
 * @param end - Range end date (capped to today).
 * @returns Array of month chunks.
 */
function generateMonthChunks(start: Date, end: Date): readonly IMonthChunk[] {
  const today = new Date();
  let cappedEnd = end;
  if (end > today) {
    cappedEnd = today;
  }
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const endTime = cappedEnd.getTime();
  return buildChunkList({ year: startYear, month: startMonth, endTime }, []);
}

export type { IMonthChunk, JsonRecord };
export { buildMonthBody, generateMonthChunks, isMonthlyEndpoint, isRangeIterable, replaceField };
