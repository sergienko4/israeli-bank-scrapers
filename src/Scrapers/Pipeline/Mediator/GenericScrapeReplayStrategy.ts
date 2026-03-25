/**
 * POST body templating — replace WellKnown fields + monthly chunks.
 * Used by ScrapePhase to iterate over accounts and date ranges.
 */

import {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../Registry/PipelineWellKnown.js';

/** Max depth for iterative replaceField BFS. */
const MAX_REPLACE_DEPTH = 15;

/**
 * Check if a value is a searchable object (not null, not array).
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObj(val: unknown): boolean {
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
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
  value: string,
): boolean {
  const keys = Object.keys(obj);
  const lowerKeys = keys.map((k): string => k.toLowerCase());
  const hit = fieldNames.find((f): boolean => {
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
function collectArrayObjs(arr: unknown[]): Record<string, unknown>[] {
  return arr
    .filter((item): boolean => isSearchableObj(item))
    .map((item): Record<string, unknown> => item as Record<string, unknown>);
}

/**
 * Collect child objects from one value (array or object).
 * @param child - Value to inspect.
 * @returns Array of child objects for BFS.
 */
function collectChildObjs(child: unknown): Record<string, unknown>[] {
  if (Array.isArray(child)) return collectArrayObjs(child);
  if (isSearchableObj(child)) {
    return [child as Record<string, unknown>];
  }
  return [];
}

/**
 * Collect all child objects from a record for BFS.
 * @param obj - Parent object.
 * @returns Array of child objects for next BFS level.
 */
function collectBfsChildren(obj: Record<string, unknown>): Record<string, unknown>[] {
  return Object.keys(obj).flatMap((k): Record<string, unknown>[] => collectChildObjs(obj[k]));
}

/**
 * Process one BFS level: replace fields + collect children.
 * @param queue - Current level objects.
 * @param fieldNames - WellKnown field names.
 * @param value - Replacement value.
 * @returns Replace status and next queue.
 */
function processReplaceLevel(
  queue: Record<string, unknown>[],
  fieldNames: readonly string[],
  value: string,
): { didReplace: boolean; next: Record<string, unknown>[] } {
  let didReplace = false;
  const next: Record<string, unknown>[] = [];
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
function replaceField(
  body: Record<string, unknown>,
  fieldNames: readonly string[],
  value: string,
): boolean {
  let didReplace = false;
  let queue: Record<string, unknown>[] = [body];
  let depth = 0;
  while (queue.length > 0 && depth < MAX_REPLACE_DEPTH) {
    const level = processReplaceLevel(queue, fieldNames, value);
    didReplace = didReplace || level.didReplace;
    queue = level.next;
    depth += 1;
  }
  return didReplace;
}

/** Options for building a monthly POST body. */
interface IMonthBodyOpts {
  readonly template: string;
  readonly accountId: string;
  readonly month: number;
  readonly year: number;
}

/**
 * Build a POST body for one month from a template.
 * @param opts - Month body options with template + values.
 * @returns New POST body as Record.
 */
function buildMonthBody(opts: IMonthBodyOpts): Record<string, unknown> {
  const body = JSON.parse(opts.template) as Record<string, unknown>;
  replaceField(body, MF.accountId, opts.accountId);
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
function isMonthlyEndpoint(postData: string): boolean {
  if (!postData) return false;
  try {
    const body = JSON.parse(postData) as Record<string, unknown>;
    const hasMonth = MF.month.some((f): boolean => body[f] !== undefined);
    const hasYear = MF.year.some((f): boolean => body[f] !== undefined);
    return hasMonth && hasYear;
  } catch {
    return false;
  }
}

/**
 * Check if a POST body has date range fields.
 * @param body - Parsed POST body.
 * @returns True if both from and to WK fields are present.
 */
function isRangeIterable(body: Record<string, unknown>): boolean {
  const lowerKeys = Object.keys(body).map((k): string => k.toLowerCase());
  const keys = new Set(lowerKeys);
  const hasFrom = WK.fromDate.some((f): boolean => {
    const lowerF = f.toLowerCase();
    return keys.has(lowerF);
  });
  const hasTo = WK.toDate.some((f): boolean => {
    const lowerF = f.toLowerCase();
    return keys.has(lowerF);
  });
  return hasFrom && hasTo;
}

/** A single month chunk with start and end ISO strings. */
interface IMonthChunk {
  readonly start: string;
  readonly end: string;
}

/**
 * Format a date as YYYY-MM-DD.
 * @param d - Date to format.
 * @returns Formatted date string.
 */
function formatDatePart(d: Date): string {
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
function advanceMonth(year: number, month: number): { year: number; month: number } {
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
function generateMonthChunks(start: Date, end: Date): readonly IMonthChunk[] {
  const today = new Date();
  const cappedEnd = end > today ? today : end;
  const chunks: IMonthChunk[] = [];
  let year = start.getFullYear();
  let month = start.getMonth();
  const endTime = cappedEnd.getTime();
  while (new Date(year, month, 1).getTime() <= endTime) {
    const chunk = buildChunk(year, month, endTime);
    chunks.push(chunk);
    const next = advanceMonth(year, month);
    year = next.year;
    month = next.month;
  }
  return chunks;
}

export type { IMonthChunk };
export { buildMonthBody, generateMonthChunks, isMonthlyEndpoint, isRangeIterable, replaceField };
