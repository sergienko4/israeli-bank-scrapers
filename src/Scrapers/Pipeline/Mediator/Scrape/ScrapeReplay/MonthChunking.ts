/**
 * Generate monthly ISO chunks for date-range iteration. Pure date
 * arithmetic — no JSON/body dependencies.
 *
 * <p>Every chunk boundary is a *calendar* question — which month a date falls
 * in, which day ends it — so it is answered in the bank's calendar rather than
 * the host's. Read in the host's zone instead, a machine an hour either side of
 * Israel enumerates a different set of months for the same window — silently
 * dropping a terminal month or asking for one the caller never wanted.
 *
 * <p>The `Z` a chunk carries is part of that formatting, not a claim about UTC:
 * it names a *bank day*. Treating it as a UTC instant is safe only for comparing
 * two labels written by this module. A consumer that needs a bank day, month,
 * or URL bound must validate the label through the bank-calendar provider;
 * projecting the apparent UTC instant back into Jerusalem moves end-of-day
 * labels into tomorrow.
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
import { boundedMonthCount, MAX_MONTH_REQUESTS } from '../MonthRangeBudget.js';

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
 * Narrow a generated chunk candidate after boundary validation.
 * @param chunk - Candidate chunk.
 * @returns True when the candidate is usable.
 */
function isMonthChunk(chunk: IMonthChunk | false): chunk is IMonthChunk {
  return chunk !== false;
}

/**
 * Build a bounded month plan without recursive stack growth.
 * @param state - First month and effective end instant.
 * @param count - Number of monthly requests to schedule.
 * @returns Complete chunks, or false on an invalid derived day.
 */
function buildChunkList(state: IChunkBuildState, count: number): MonthChunks | false {
  const chunks = Array.from({ length: count }, (_, offset) => {
    const month = shiftBankMonth(state.month, offset);
    return buildChunk(month, state.endTime);
  });
  return chunks.every(isMonthChunk) ? chunks : false;
}

/**
 * Resolve the requested end against today and future-month settings.
 * @param end - Requested end instant.
 * @param futureMonths - Months beyond today.
 * @returns Effective end instant, or false for invalid input.
 */
function resolveEndDate(end: Date, futureMonths?: number): Date | false {
  const endTime = end.getTime();
  if (!Number.isFinite(endTime)) return false;
  const today = new Date();
  if (futureMonths && futureMonths > 0) return shiftBankInstant(today, futureMonths);
  return endTime > today.getTime() ? today : end;
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
 * Count chunks after both range endpoints have entered the month domain.
 * @param state - First month and effective end instant.
 * @returns Bounded count, or false when the range is unsafe.
 */
function chunkCount(state: IChunkBuildState): number | false {
  const last = bankMonthOfInstant(new Date(state.endTime));
  return last === false ? false : boundedMonthCount(state.month, last);
}

/**
 * Build a month plan only when it fits the request budget.
 * @param state - First month and effective end instant.
 * @returns Bounded chunks, or false when the plan is rejected.
 */
function buildBoundedChunks(state: IChunkBuildState): MonthChunks | false {
  const count = chunkCount(state);
  if (count === false) {
    return rejectChunks(`range exceeds ${String(MAX_MONTH_REQUESTS)}-request budget`);
  }
  const chunks = buildChunkList(state, count);
  return chunks === false ? rejectChunks('invalid derived boundary') : chunks;
}

/**
 * Surface an invalid generation input and fail closed.
 * @param reason - Non-sensitive failure reason.
 * @returns False so callers cannot mistake rejection for a valid empty plan.
 */
function rejectChunks(reason: string): false {
  LOG.warn({ message: `Month chunk generation skipped: ${reason}` });
  return false;
}

/**
 * Generate monthly chunks for a date range.
 * @param start - Range start date.
 * @param end - Range end date (capped to today unless futureMonths).
 * @param futureMonths - Extra billing months beyond today.
 * @returns Month chunks, or false for invalid, reversed, or oversized input.
 */
function generateMonthChunks(start: Date, end: Date, futureMonths?: number): MonthChunks | false {
  const cappedEnd = resolveEndDate(end, futureMonths);
  if (cappedEnd === false) return rejectChunks('invalid end date');
  if (start.getTime() > cappedEnd.getTime()) return rejectChunks('start date follows end date');
  const state = buildInitialState(start, cappedEnd);
  if (state === false) return rejectChunks('invalid start date');
  return buildBoundedChunks(state);
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
