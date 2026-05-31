/**
 * PiiRedactor — Common helpers shared across per-category modules.
 *
 * Phase 6: hosts utilities used by 2+ per-category redactors so each
 * module stays under the 200-LoC cap without duplicating code. Phase
 * 6 §1 forbids duplicating helpers — anything used in more than one
 * category module lives here.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import type { PiiCountInt } from './Types.js';
import { REDACTED_HINT } from './Types.js';

/**
 * PII regex set applied to free-form literal text content (not
 * structured JSON keys / values). Shared by:
 *
 *  - `JsonBody.applyFallbackPatterns` — both the non-JSON fallback
 *    path AND the post-stringify defense-in-depth scrub.
 *  - `Html.redactHtml`                — text-node content scrub.
 *
 * Co-locating the table prevents the two redaction surfaces from
 * drifting — adding a new PII pattern (e.g., a new BIN range) updates
 * both surfaces atomically.
 */
export const LITERAL_TEXT_PII_PATTERNS: readonly { readonly re: RegExp; readonly to: string }[] = [
  { re: /\b(\d{2}-\d{3}-)\d+(\d{4})\b/g, to: '$1***$2' },
  { re: /(?<!\d)\d{5}(\d{4})(?!\d)/g, to: '***$1' },
  { re: /eyJ[\w-]{20,}/g, to: REDACTED_HINT },
];

/**
 * Build a Segmenter via Reflect.construct (DI rule). Exported so
 * specialised callers (e.g. test harnesses) can build their own
 * segmenter without duplicating the construction site.
 * @returns Grapheme segmenter (Intl.Segmenter is required by Node 22+).
 */
export function buildSegmenter(): Intl.Segmenter {
  return Reflect.construct(Intl.Segmenter, ['und', { granularity: 'grapheme' }]);
}

/**
 * Count Unicode graphemes in a string using Intl.Segmenter (correct
 * for Hebrew, emoji, and combining marks).
 * @param input - String to measure.
 * @returns Grapheme count.
 */
export function graphemeCount(input: string): PiiCountInt {
  if (input.length === 0) return 0 as PiiCountInt;
  const segmenter = buildSegmenter();
  const segments = segmenter.segment(input);
  return Array.from(segments).length as PiiCountInt;
}
