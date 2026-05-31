/**
 * PiiRedactor — Israeli ID category.
 *
 * Phase 6 commit 2: 9-digit national ID classifier + redactor
 * extracted from `../PiiRedactor.ts`. Validates exactly 9 ASCII
 * digits (after stripping non-digits) and returns a `***XXXX` last-4
 * hint; default-deny otherwise.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiHintString,
  REDACTED_HINT,
} from './Types.js';

/** Israeli ID is exactly 9 digits. */
const ISRAELI_ID_LEN = 9;
/** Pattern stripping every non-digit character before length validation. */
const NON_DIGIT_RE = /\D/g;

/** Israeli ID strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'israeliId';

/**
 * Israeli ID strategy. Validates 9 ASCII digits; returns last-4
 * hint, otherwise the REDACTED hint.
 * @param value - Raw value.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const digits = value.replaceAll(NON_DIGIT_RE, '');
  if (digits.length !== ISRAELI_ID_LEN) return REDACTED_HINT as PiiHintString;
  return `***${digits.slice(-4)}` as PiiHintString;
}

export { redact, redact as redactIsraeliId };
