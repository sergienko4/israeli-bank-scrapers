/**
 * PiiRedactor — Phone category.
 *
 * Phase 6 commit 3: phone-number redactor extracted from
 * `../PiiRedactor.ts`. Returns `***XXXX` last-4 hint across any
 * separator; default-deny when fewer than 4 digits remain.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiHintString,
  REDACTED_HINT,
} from './Types.js';

/** Minimum identifier length required to extract a stable last-4 hint. */
const MIN_HINT_LEN = 4;
/** Pattern stripping every non-digit character before length validation. */
const NON_DIGIT_RE = /\D/g;

/** Phone strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'phone';

/**
 * Phone strategy. Extracts trailing 4 digits across any separator.
 * @param value - Raw phone.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const digits = value.replaceAll(NON_DIGIT_RE, '');
  if (digits.length < MIN_HINT_LEN) return REDACTED_HINT as PiiHintString;
  return `***${digits.slice(-4)}` as PiiHintString;
}

export { redact, redact as redactPhone };
