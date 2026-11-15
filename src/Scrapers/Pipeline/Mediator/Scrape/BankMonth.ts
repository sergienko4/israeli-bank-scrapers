/**
 * Typed bank-calendar month arithmetic and instant projection.
 *
 * A chunk's trailing `Z` is a formatting convention, not a UTC claim; this
 * module projects resolved instants and moves named months without host-local
 * `Date` arithmetic.
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

export type { IBankMonth };
export { bankMonthBounds, bankMonthOfInstant, shiftBankInstant, shiftBankMonth };
