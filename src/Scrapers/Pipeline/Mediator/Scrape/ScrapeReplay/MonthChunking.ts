/**
 * Generate monthly ISO chunks for date-range iteration. Pure date
 * arithmetic — no JSON/body dependencies.
 */

/** A single month chunk with start and end ISO strings. */
interface IMonthChunk {
  readonly start: string;
  readonly end: string;
}

/** Width for two-digit zero-padded day/month parts. */
const DATE_PART_PAD_WIDTH = 2;

/** Zero-based index of December (last calendar month, used as wrap boundary). */
const DECEMBER_INDEX = 11;

/** Bundled state for the recursive chunk builder. */
interface IChunkBuildState {
  readonly year: number;
  readonly month: number;
  readonly endTime: number;
}

/**
 * Format a date as YYYY-MM-DD.
 * @param d - Date to format.
 * @returns Formatted date string.
 */
function formatDatePart(d: Date): string {
  const fullYear = d.getFullYear();
  const monthIdx = d.getMonth() + 1;
  const dayNum = d.getDate();
  const y = String(fullYear);
  const m = String(monthIdx).padStart(DATE_PART_PAD_WIDTH, '0');
  const day = String(dayNum).padStart(DATE_PART_PAD_WIDTH, '0');
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
  if (next > DECEMBER_INDEX) return { year: year + 1, month: 0 };
  return { year, month: next };
}

/**
 * Compute the end-of-chunk day, capped by `endTime`.
 * @param year - Chunk year.
 * @param month - Chunk month (0-indexed).
 * @param endTime - Max end time in ms.
 * @returns Day as YYYY-MM-DD.
 */
function computeChunkEndDay(year: number, month: number, endTime: number): string {
  const lastDayDate = new Date(year, month + 1, 0);
  const lastDayMs = lastDayDate.getTime();
  const chunkEndMs = Math.min(lastDayMs, endTime);
  const chunkEndDate = new Date(chunkEndMs);
  return formatDatePart(chunkEndDate);
}

/**
 * Build one month chunk with start/end ISO timestamps.
 * @param year - Chunk year.
 * @param month - Chunk month (0-indexed).
 * @param endTime - Max end time in ms.
 * @returns Month chunk.
 */
function buildChunk(year: number, month: number, endTime: number): IMonthChunk {
  const pad = String(month + 1).padStart(DATE_PART_PAD_WIDTH, '0');
  const firstDay = `${String(year)}-${pad}-01`;
  const endDay = computeChunkEndDay(year, month, endTime);
  return {
    start: `${firstDay}T00:00:00.000Z`,
    end: `${endDay}T23:59:59.000Z`,
  };
}

/**
 * Check if the iterator has reached past the end time.
 * @param state - Current build state.
 * @returns True when the current month is past endTime.
 */
function reachedEnd(state: IChunkBuildState): boolean {
  const currentMs = new Date(state.year, state.month, 1).getTime();
  return currentMs > state.endTime;
}

/**
 * Recursively build month chunks until end date.
 * @param state - Current year/month/endTime.
 * @param accumulated - Chunks collected so far.
 * @returns Complete chunk list.
 */
function buildChunkList(
  state: IChunkBuildState,
  accumulated: readonly IMonthChunk[],
): readonly IMonthChunk[] {
  if (reachedEnd(state)) return accumulated;
  const chunk = buildChunk(state.year, state.month, state.endTime);
  const next = advanceMonth(state.year, state.month);
  const nextState: IChunkBuildState = { ...next, endTime: state.endTime };
  return buildChunkList(nextState, [...accumulated, chunk]);
}

/**
 * Apply a futureMonths offset to today.
 * @param today - Today's date.
 * @param futureMonths - Number of months to add.
 * @returns Extended end date.
 */
function applyFutureMonths(today: Date, futureMonths: number): Date {
  const future = new Date(today);
  future.setMonth(future.getMonth() + futureMonths);
  return future;
}

/**
 * Compute the effective end date — extend by futureMonths or cap to today.
 * @param end - Requested end date.
 * @param futureMonths - Extra billing months beyond today.
 * @returns Resolved end date.
 */
function resolveEndDate(end: Date, futureMonths?: number): Date {
  const today = new Date();
  if (futureMonths && futureMonths > 0) return applyFutureMonths(today, futureMonths);
  const capMap: Record<string, Date> = { true: today, false: end };
  return capMap[String(end > today)];
}

/**
 * Build the initial chunk-build state from start + capped-end dates.
 * @param start - Range start date.
 * @param cappedEnd - Effective end date.
 * @returns Initial state for buildChunkList.
 */
function buildInitialState(start: Date, cappedEnd: Date): IChunkBuildState {
  const year = start.getFullYear();
  const month = start.getMonth();
  const endTime = cappedEnd.getTime();
  return { year, month, endTime };
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
  const state = buildInitialState(start, cappedEnd);
  return buildChunkList(state, []);
}

export type { IMonthChunk };
export { generateMonthChunks };
