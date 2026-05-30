/**
 * PiiRedactor — Name category.
 *
 * Phase 6 commit 3: human-name redactor extracted from
 * `../PiiRedactor.ts`. Returns `<name:N>` length-class hint where N is
 * the Unicode grapheme count (correct for Hebrew + emoji + combining
 * marks).
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import { graphemeCount } from './CommonHelpers.js';
import { isPiiRedactionDisabled, type PiiCategory, type PiiHintString } from './Types.js';

/** Name strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'name';

/**
 * Name strategy. Returns `<name:N>` where N = grapheme count.
 * @param value - Raw name.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const n = graphemeCount(value);
  return `<name:${String(n)}>` as PiiHintString;
}

export { redact, redact as redactName };
