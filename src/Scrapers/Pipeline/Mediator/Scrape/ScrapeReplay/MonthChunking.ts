/**
 * Generate monthly ISO chunks for date-range iteration. Pure date
 * arithmetic — no JSON/body dependencies.
 *
 * <p>Every chunk boundary is a *calendar* question — which month a date falls
 * in, which day ends it — so it is answered in the bank's calendar rather than
 * the host's. Every consumer reads a chunk as a label (splitting the string, or
 * lifting Day/Month/Year out of it) and none treats it as an instant, so the
 * `Z` suffix names a bank day and not a UTC moment.
 *
 * <p>Read in the host's zone instead, a machine an hour either side of Israel
 * enumerates a different set of months for the same window — silently dropping
 * a terminal month, or asking for one the caller never wanted.
 */

import moment from 'moment-timezone';

import { BANK_CALENDAR_TIMEZONE } from '../BankCalendar.js';

/** A single month chunk with start and end ISO strings. */
interface IMonthChunk {
  readonly start: string;
  readonly end: string;
}

/** Bundled state for the recursive chunk builder. */
interface IChunkBuildState {
  readonly year: number;
  readonly month: number;
  readonly endTime: number;
}

/**
 * Read an instant as a moment in the bank's calendar.
 * @param d - Instant to place.
 * @returns The same instant, expressed in the bank's zone.
 */
function inBankZone(d: Date): moment.Moment {
  return moment(d).tz(BANK_CALENDAR_TIMEZONE);
}

/**
 * The first moment of a bank-calendar month.
 * @param year - Calendar year.
 * @param month - Month, 0-indexed.
 * @returns Start of that month in the bank's zone.
 */
function bankMonthStart(year: number, month: number): moment.Moment {
  return moment.tz({ year, month, day: 1 }, BANK_CALENDAR_TIMEZONE).startOf('day');
}

/**
 * Format an instant as the bank-calendar day it falls on.
 * @param d - Instant to name.
 * @returns Day as YYYY-MM-DD.
 */
function formatDatePart(d: Date): string {
  return inBankZone(d).format('YYYY-MM-DD');
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
 * Compute the end-of-chunk day, capped by `endTime`.
 * @param year - Chunk year.
 * @param month - Chunk month (0-indexed).
 * @param endTime - Max end time in ms.
 * @returns Day as YYYY-MM-DD.
 */
function computeChunkEndDay(year: number, month: number, endTime: number): string {
  const lastDay = bankMonthStart(year, month).endOf('month').startOf('day');
  const lastDayMs = lastDay.valueOf();
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
  const pad = String(month + 1).padStart(2, '0');
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
  const currentMs = bankMonthStart(state.year, state.month).valueOf();
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
  const future = inBankZone(today).add(futureMonths, 'months');
  return future.toDate();
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
  const bankStart = inBankZone(start);
  const year = bankStart.year();
  const month = bankStart.month();
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
