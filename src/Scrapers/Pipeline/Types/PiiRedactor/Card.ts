/**
 * PiiRedactor — Card category.
 *
 * Phase 6 commit 2: card-number classifier + redactor extracted from
 * `../PiiRedactor.ts`. Returns `****XXXX` last-4 hint for card-shaped
 * strings, default-deny when the input is shorter than 4 chars.
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

/** Card strategy descriptor — registered in the Facade strategy table. */
export const CATEGORY: PiiCategory = 'card';

/**
 * Card strategy. Returns `****` + last 4 digits.
 * @param value - Raw card string.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  if (value.length < MIN_HINT_LEN) return REDACTED_HINT as PiiHintString;
  return `****${value.slice(-4)}` as PiiHintString;
}

export { redact, redact as redactCard };
