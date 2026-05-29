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
