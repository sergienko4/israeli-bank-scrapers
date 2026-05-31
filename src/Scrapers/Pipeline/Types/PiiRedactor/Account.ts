/**
 * PiiRedactor — Account category.
 *
 * Phase 6 commit 2: account-number classifier + redactor extracted
 * from `../PiiRedactor.ts`. Returns `***XXXX` last-4 hint for any
 * account-style string, default-deny for inputs shorter than 4
 * graphemes after the terminal separator.
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

/** Minimum identifier length required to extract a stable last-4 hint. */
const MIN_HINT_LEN = 4;

/** Account strategy descriptor — registered in the Facade strategy table. */
export const CATEGORY: PiiCategory = 'account';

/**
 * Locate the last separator index across `-`, `/`, ` `.
 * @param value - Input string.
 * @returns Last separator index, or -1.
 */
function lastSeparatorIndex(value: string): PiiCountInt {
  const dash = value.lastIndexOf('-');
  const slash = value.lastIndexOf('/');
  const space = value.lastIndexOf(' ');
  return Math.max(dash, slash, space) as PiiCountInt;
}

/**
 * Slice the terminal segment of an account-style string after the
 * last separator. Returns the whole string when no separator is
 * present.
 * @param value - Account-style input.
 * @returns Terminal segment.
 */
function terminalSegment(value: string): PiiHintString {
  const sep = lastSeparatorIndex(value);
  if (sep === -1) return value as PiiHintString;
  return value.slice(sep + 1) as PiiHintString;
}

/**
 * Account-number strategy. Returns `***` + last 4 digits of the
 * terminal segment.
 * @param value - Raw account string.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const tail = terminalSegment(value);
  if (tail.length <= MIN_HINT_LEN) return REDACTED_HINT as PiiHintString;
  return `***${tail.slice(-4)}` as PiiHintString;
}

export { redact, redact as redactAccount };
