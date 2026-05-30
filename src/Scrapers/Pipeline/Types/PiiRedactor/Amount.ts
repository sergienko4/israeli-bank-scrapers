/**
 * PiiRedactor — Amount category.
 *
 * Phase 6 commit 4: amount redactor extracted from
 * `../PiiRedactor.ts`. Returns a sign-preserving marker (`+***` /
 * `-***`) so engineers retain debit/credit signal without exposing
 * the magnitude.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiCountInt,
  type PiiHintString,
  REDACTED_HINT,
} from './Types.js';

/** Amount strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'amount';

/**
 * Coerce a number-or-string to a number, leaving NaN on bad input.
 * @param value - Number or numeric string.
 * @returns Number (NaN when value is non-numeric).
 */
function coerceToNumber(value: number | string): PiiCountInt {
  if (typeof value === 'number') return value as PiiCountInt;
  return Number(value) as PiiCountInt;
}

/**
 * Amount strategy. Returns sign-only marker. Blank or whitespace-only
 * strings are treated as non-numeric (Number('') coerces to 0, which
 * would otherwise mislabel "no amount" as a positive value).
 * @param value - Number or numeric string.
 * @returns Stable hint.
 */
function redact(value: number | string): PiiHintString {
  if (isPiiRedactionDisabled) return String(value) as PiiHintString;
  if (typeof value === 'string' && value.trim().length === 0) {
    return REDACTED_HINT as PiiHintString;
  }
  const num = coerceToNumber(value);
  if (Number.isNaN(num)) return REDACTED_HINT as PiiHintString;
  if (num < 0) return '-***' as PiiHintString;
  return '+***' as PiiHintString;
}

export { redact, redact as redactAmount };
