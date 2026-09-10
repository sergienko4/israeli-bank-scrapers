/**
 * Generate monthly ISO chunks for date-range iteration. Pure date
 * arithmetic — no JSON/body dependencies.
 *
 * <p>Every chunk boundary is a *calendar* question — which month a date falls
 * in, which day ends it — so it is answered in the bank's calendar rather than
 * the host's. Read in the host's zone instead, a machine an hour either side of
 * Israel enumerates a different set of months for the same window — silently
 * dropping a terminal month, or asking for one the caller never wanted.
 *
 * <p>The `Z` a chunk carries is part of that formatting, not a claim about UTC:
 * it names a *bank day*. Consumers do hand these strings to `new Date()`, which
 * is safe for ordering and for range filters, but asking the resulting instant
 * which month it is re-opens the very host-dependence the boundaries were
 * chosen to close. Anything that needs the month must read the label, via
 * {@link chunkStartMonth}, rather than the parsed instant.
 */

import { getDebug } from '../../../Logging/Debug.js';
import type { BankDay } from '../BankCalendar.js';
import { bankDayOfInstant } from '../BankCalendar.js';
import type { IBankMonth } from '../BankMonth.js';
import {
  bankMonthBounds,
  bankMonthOfInstant,
  bankMonthOfLabel,
  shiftBankInstant,
  shiftBankMonth,
} from '../BankMonth.js';

const LOG = getDebug(import.meta.url);

/** A single month chunk with start and end ISO strings. */
interface IMonthChunk {
  readonly start: string;
  readonly end: string;
}

type MonthChunks = readonly IMonthChunk[];

/** Bundled state for the recursive chunk builder. */
interface IChunkBuildState {
  readonly month: IBankMonth;
  readonly endTime: number;
}

/**
 * Build one month chunk, capped by the requested end instant.
 * @param month - Named bank month.
 * @param endTime - Maximum end instant in milliseconds.
 * @returns Month chunk, or false when a derived day is invalid.
 */
function buildChunk(month: IBankMonth, endTime: number): IMonthChunk | false {
  const bounds = bankMonthBounds(month);
  const startDay = bankDayOfInstant(bounds.start);
  const boundEndTime = bounds.end.getTime();
  const cappedEndTime = Math.min(boundEndTime, endTime);
  const cappedEnd = new Date(cappedEndTime);
  const endDay = bankDayOfInstant(cappedEnd);
  if (startDay === false || endDay === false) return false;
  return stampChunk(startDay, endDay);
}

/**
 * Render validated bank days as the legacy chunk shape.
 * @param startDay - First day of the chunk.
 * @param endDay - Last day of the chunk.
 * @returns Timestamp-shaped bank labels.
 */
function stampChunk(startDay: BankDay, endDay: BankDay): IMonthChunk {
  return {
    start: `${startDay}T00:00:00.000Z`,
    end: `${endDay}T23:59:59.000Z`,
  };
}

/**
 * Check whether the current month starts after the end instant.
 * @param state - Current month and end instant.
 * @returns True when iteration is complete.
 */
function reachedEnd(state: IChunkBuildState): boolean {
  const bounds = bankMonthBounds(state.month);
  return bounds.start.getTime() > state.endTime;
}

/**
 * Recursively build chunks through the effective end instant.
 * @param state - Current month and end instant.
 * @param accumulated - Chunks already built.
 * @returns Complete chunks, or false on an invalid derived day.
 */
function buildChunkList(
  state: IChunkBuildState,
  accumulated: readonly IMonthChunk[],
): readonly IMonthChunk[] | false {
  if (reachedEnd(state)) return accumulated;
  const chunk = buildChunk(state.month, state.endTime);
  if (chunk === false) return false;
  const month = shiftBankMonth(state.month, 1);
  return buildChunkList({ ...state, month }, [...accumulated, chunk]);
}

/**
 * Resolve the requested end against today and future-month settings.
 * @param end - Requested end instant.
 * @param futureMonths - Months beyond today.
 * @returns Effective end instant, or false for invalid input.
 */
function resolveEndDate(end: Date, futureMonths?: number): Date | false {
  const today = new Date();
  if (futureMonths && futureMonths > 0) return shiftBankInstant(today, futureMonths);
  const capped = end > today ? today : end;
  const endTime = capped.getTime();
  return Number.isFinite(endTime) ? capped : false;
}

/**
 * Build initial iteration state.
 * @param start - Requested start instant.
 * @param cappedEnd - Effective end instant.
 * @returns Initial state, or false for an invalid start.
 */
function buildInitialState(start: Date, cappedEnd: Date): IChunkBuildState | false {
  const month = bankMonthOfInstant(start);
  if (month === false) return false;
  return { month, endTime: cappedEnd.getTime() };
}

/**
 * Surface an invalid generation input and fail closed.
 * @param reason - Non-sensitive failure reason.
 * @returns Empty chunk list.
 */
function rejectChunks(reason: string): readonly IMonthChunk[] {
  LOG.warn({ message: `Month chunk generation skipped: ${reason}` });
  return [];
}

/**
 * Generate monthly chunks for a date range.
 * @param start - Range start date.
 * @param end - Range end date (capped to today unless futureMonths).
 * @param futureMonths - Extra billing months beyond today.
 * @returns Array of month chunks.
 */
function generateMonthChunks(start: Date, end: Date, futureMonths?: number): MonthChunks {
  const cappedEnd = resolveEndDate(end, futureMonths);
  if (cappedEnd === false) return rejectChunks('invalid end date');
  const state = buildInitialState(start, cappedEnd);
  if (state === false) return rejectChunks('invalid start date');
  const chunks = buildChunkList(state, []);
  if (chunks === false) return rejectChunks('invalid derived boundary');
  return chunks;
}

/** Calendar year and 1-indexed month that a chunk's start names. */
type IChunkMonth = IBankMonth;

/**
 * Read the month a chunk *names*, which is the exact inverse of how
 * {@link buildChunk} writes it: the `YYYY-MM` prefix of the start label. It
 * never parses the stamp, so no host zone can shift the answer.
 * @param chunk - The chunk to read.
 * @returns Its year and 1-indexed month, or false for an invalid label.
 */
function chunkStartMonth(chunk: IMonthChunk): IChunkMonth | false {
  return bankMonthOfLabel(chunk.start);
}

export type { IChunkMonth, IMonthChunk };
export { chunkStartMonth, generateMonthChunks };
