/**
 * Typed bank-calendar month parsing and arithmetic.
 *
 * Labels and instants are separate inputs: a chunk's trailing `Z` is a
 * formatting convention, while a Date is a resolved instant. This module is
 * the one boundary that converts either input into the same month domain.
 */

import { BANK_DAY_FORMAT, bankMomentOfInstant, parseInBankZone } from './BankCalendar.js';

/** Calendar year and 1-indexed month in the bank's timezone. */
interface IBankMonth {
  readonly year: number;
  readonly month: number;
}

/** Calendar date components read from a strict bank label. */
interface IBankDateParts extends IBankMonth {
  readonly day: number;
}

/** Start/end instants delimiting one bank-calendar month. */
interface IBankMonthBounds {
  readonly start: Date;
  readonly end: Date;
}

const BANK_MONTH_LABEL_PATTERNS = [
  /^(\d{4})-(\d{2})$/,
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z?$/,
] as const;
const BANK_TIMESTAMP_LABEL_FORMAT = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
const SLASHED_BANK_MONTH_LABEL = /^(\d{2})\/(\d{4})$/;
const DAYS_BY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MIN_MONTH = 1;
const MAX_MONTH = 12;

/**
 * Match any supported bank month/date/timestamp label shape.
 * @param value - Candidate bank label.
 * @returns Captures with year/month/day in the first three groups, or false.
 */
function matchBankLabel(value: string): RegExpExecArray | false {
  const matches = BANK_MONTH_LABEL_PATTERNS.map(pattern => pattern.exec(value));
  return matches.find(match => match !== null) ?? false;
}

/**
 * Build a validated bank month.
 * @param year - Calendar year.
 * @param month - 1-indexed calendar month.
 * @returns Validated month, or false.
 */
function validatedMonth(year: number, month: number): IBankMonth | false {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
  if (month < MIN_MONTH || month > MAX_MONTH) return false;
  return { year, month };
}

/**
 * Convert year/month captures into a validated month.
 * @param yearRaw - Four-digit year capture.
 * @param monthRaw - Two-digit month capture.
 * @returns Validated month, or false.
 */
function monthOfCaptures(yearRaw: string, monthRaw: string): IBankMonth | false {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return validatedMonth(year, month);
}

/**
 * Decide whether February has a leap day.
 * @param year - Calendar year.
 * @returns True for a Gregorian leap year.
 */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Maximum valid day in a month.
 * @param value - Validated month.
 * @returns Last valid day number.
 */
function lastDayOf(value: IBankMonth): number {
  if (value.month === 2 && isLeapYear(value.year)) return 29;
  return DAYS_BY_MONTH[value.month - 1] ?? 0;
}

/**
 * Validate an optional day capture.
 * @param raw - Optional two-digit day.
 * @param month - Validated month.
 * @returns True when absent or inside the month.
 */
function hasValidDay(raw: string | false, month: IBankMonth): boolean {
  if (raw === false) return true;
  const day = Number(raw);
  return day >= 1 && day <= lastDayOf(month);
}

/**
 * Read a strict ISO-shaped bank label.
 * @param value - Bank label, optionally followed by a day/time suffix.
 * @returns Validated bank month, or false.
 */
function bankMonthOfLabel(value: string): IBankMonth | false {
  const match = matchBankLabel(value);
  if (match === false) return false;
  const month = monthOfCaptures(match[1], match[2]);
  const capturedDay = match.at(3);
  const day = capturedDay ?? false;
  if (month === false || !hasValidDay(day, month)) return false;
  return month;
}

/**
 * Read complete date parts from a strict bank label.
 * @param value - Bank label carrying a calendar day.
 * @returns Validated date parts, or false.
 */
function bankDatePartsOfLabel(value: string): IBankDateParts | false {
  const match = matchBankLabel(value);
  if (match === false) return false;
  const month = monthOfCaptures(match[1], match[2]);
  const rawDay = match.at(3);
  if (month === false || rawDay === undefined || !hasValidDay(rawDay, month)) return false;
  const day = Number(rawDay);
  return { ...month, day };
}

/**
 * Project an instant into complete bank-calendar date parts.
 * @param value - Resolved instant.
 * @returns Bank date parts, or false for invalid input.
 */
function bankDatePartsOfInstant(value: string | Date): IBankDateParts | false {
  const inBank = bankMomentOfInstant(value);
  if (!inBank.isValid()) return false;
  const year = inBank.year();
  const month = inBank.month() + 1;
  const day = inBank.date();
  return { year, month, day };
}

/**
 * Read a provider `MM/YYYY` billing label.
 * @param value - Provider billing label.
 * @returns Validated bank month, or false.
 */
function bankMonthOfSlashedLabel(value: string): IBankMonth | false {
  const match = SLASHED_BANK_MONTH_LABEL.exec(value);
  if (match === null) return false;
  return monthOfCaptures(match[2], match[1]);
}

/**
 * Project an instant into the bank's month.
 * @param value - Resolved instant.
 * @returns Bank month, or false for an invalid instant.
 */
function bankMonthOfInstant(value: string | Date): IBankMonth | false {
  const inBank = bankMomentOfInstant(value);
  if (!inBank.isValid()) return false;
  const year = inBank.year();
  const month = inBank.month() + 1;
  return validatedMonth(year, month);
}

/**
 * Open a generated timestamp label onto its bank-zone instant.
 * @param value - Timestamp-shaped bank label with a formatting-only Z.
 * @returns Resolved instant, or false for an invalid label.
 */
function bankInstantOfLabel(value: string): Date | false {
  const parts = bankDatePartsOfLabel(value);
  if (parts === false) return false;
  const parsed = parseInBankZone(value, BANK_TIMESTAMP_LABEL_FORMAT, true);
  return parsed.isValid() ? parsed.toDate() : false;
}

/**
 * Shift a validated bank month.
 * @param value - Source month.
 * @param amount - Signed number of months.
 * @returns Shifted bank month.
 */
function shiftBankMonth(value: IBankMonth, amount: number): IBankMonth {
  const index = value.year * 12 + value.month - 1 + amount;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return { year, month };
}

/**
 * Shift a resolved instant in the bank calendar.
 * @param value - Source instant.
 * @param amount - Signed number of months.
 * @returns Shifted instant, or false for invalid input.
 */
function shiftBankInstant(value: Date, amount: number): Date | false {
  const inBank = bankMomentOfInstant(value);
  if (!inBank.isValid()) return false;
  return inBank.add(amount, 'months').toDate();
}

/**
 * Render a month-start label for bank-zone construction.
 * @param value - Validated bank month.
 * @returns YYYY-MM-01 label.
 */
function monthStartLabel(value: IBankMonth): string {
  const year = String(value.year).padStart(4, '0');
  const month = String(value.month).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Build the first and last instants of a bank month.
 * @param value - Validated bank month.
 * @returns Bank-zone month bounds.
 */
function bankMonthBounds(value: IBankMonth): IBankMonthBounds {
  const label = monthStartLabel(value);
  const startMoment = parseInBankZone(label, BANK_DAY_FORMAT, true);
  const endMoment = startMoment.clone();
  endMoment.endOf('month').endOf('day');
  return { start: startMoment.toDate(), end: endMoment.toDate() };
}

export type { IBankDateParts, IBankMonth, IBankMonthBounds };
export {
  bankDatePartsOfInstant,
  bankDatePartsOfLabel,
  bankInstantOfLabel,
  bankMonthBounds,
  bankMonthOfInstant,
  bankMonthOfLabel,
  bankMonthOfSlashedLabel,
  shiftBankInstant,
  shiftBankMonth,
};
