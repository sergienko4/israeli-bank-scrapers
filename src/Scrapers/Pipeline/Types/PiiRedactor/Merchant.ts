/**
 * PiiRedactor — Merchant category.
 *
 * Phase 6 commit 3: merchant / description redactor extracted from
 * `../PiiRedactor.ts`. Returns `<merchant:N>` length-class hint where
 * N is the Unicode grapheme count.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import { graphemeCount } from './CommonHelpers.js';
import { isPiiRedactionDisabled, type PiiCategory, type PiiHintString } from './Types.js';

/** Merchant strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'merchant';

/**
 * Merchant / description strategy. Returns `<merchant:N>`.
 * @param value - Raw merchant string.
 * @returns Stable hint.
 */
function redact(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const n = graphemeCount(value);
  return `<merchant:${String(n)}>` as PiiHintString;
}

export { redact, redact as redactMerchant };
