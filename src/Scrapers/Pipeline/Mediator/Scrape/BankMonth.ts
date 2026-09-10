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

/** Start/end instants delimiting one bank-calendar month. */
interface IBankMonthBounds {
  readonly start: Date;
  readonly end: Date;
}

const BANK_MONTH_LABEL_FORMATS = [
  'YYYY-MM',
  'YYYY-MM-DD',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
  'YYYY-MM-DDTHH:mm:ss[Z]',
  'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
];
const SLASHED_BANK_MONTH_FORMAT = 'MM/YYYY';
const MIN_MONTH = 1;
const MAX_MONTH = 12;

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
 * Read a strict ISO-shaped bank label.
 * @param value - Bank label, optionally followed by a day/time suffix.
 * @returns Validated bank month, or false.
 */
function bankMonthOfLabel(value: string): IBankMonth | false {
  const parsed = parseInBankZone(value, BANK_MONTH_LABEL_FORMATS, true);
  if (!parsed.isValid()) return false;
  const year = parsed.year();
  const month = parsed.month() + 1;
  return validatedMonth(year, month);
}

/**
 * Read a provider `MM/YYYY` billing label.
 * @param value - Provider billing label.
 * @returns Validated bank month, or false.
 */
function bankMonthOfSlashedLabel(value: string): IBankMonth | false {
  const parsed = parseInBankZone(value, SLASHED_BANK_MONTH_FORMAT, true);
  if (!parsed.isValid()) return false;
  const year = parsed.year();
  const month = parsed.month() + 1;
  return validatedMonth(year, month);
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
 * Render a month-start label for bank-zone construction.
 * @param value - Validated bank month.
 * @returns YYYY-MM-01 label.
 */
function monthStartLabel(value: IBankMonth): string {
  const month = String(value.month).padStart(2, '0');
  return `${String(value.year)}-${month}-01`;
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

export type { IBankMonth, IBankMonthBounds };
export {
  bankMonthBounds,
  bankMonthOfInstant,
  bankMonthOfLabel,
  bankMonthOfSlashedLabel,
  shiftBankMonth,
};
