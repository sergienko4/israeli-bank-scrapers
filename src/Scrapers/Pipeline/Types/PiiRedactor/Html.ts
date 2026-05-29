/**
 * PiiRedactor — HTML category.
 *
 * Phase 6 commit 4: HTML body redactor extracted from
 * `../PiiRedactor.ts`. Replaces well-known PII patterns inside text
 * nodes AND inside input `value=` attributes; structure is preserved
 * so the redacted HTML still renders for layout inspection.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §1.
 */

import { graphemeCount } from './CommonHelpers.js';
import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiHintString,
  REDACTED_HINT,
} from './Types.js';

/** HTML strategy descriptor — registered in the Facade. */
export const CATEGORY: PiiCategory = 'html';

/** HTML scrubbing patterns applied to text content. */
const HTML_TEXT_PATTERNS: readonly { readonly re: RegExp; readonly to: string }[] = [
  { re: /\b(\d{2}-\d{3}-)\d+(\d{4})\b/g, to: '$1***$2' },
  { re: /(?<!\d)\d{5}(\d{4})(?!\d)/g, to: '***$1' },
  { re: /eyJ[\w-]{20,}/g, to: REDACTED_HINT },
];

/** Regex matching `value="…"` / `value='…'` attributes (single capture). */
const HTML_VALUE_ATTR_RE = /value\s*=\s*["']([^"']{2,})["']/gi;

/**
 * Replace the captured `value=` content with a grapheme-count length
 * tag. Single-capture regex keeps the callback at 2 params.
 * @param _match - Whole match (unused; placeholder per replace API).
 * @param content - Captured `value=` content.
 * @returns Redacted attribute (always normalised to double quotes).
 */
function replaceValueAttr(_match: string, content: string): PiiHintString {
  const trimmed = content.trim();
  if (trimmed.length === 0) return `value="${content}"` as PiiHintString;
  const n = graphemeCount(content);
  return `value="<name:${String(n)}>"` as PiiHintString;
}

/**
 * Redact an HTML string. Replaces well-known PII patterns inside text
 * nodes and inside input `value=` attributes. Structure is preserved.
 * @param html - Raw HTML.
 * @returns Redacted HTML.
 */
function redact(html: string): PiiHintString {
  if (isPiiRedactionDisabled) return html as PiiHintString;
  if (html.length === 0) return '' as PiiHintString;
  let out = html;
  for (const p of HTML_TEXT_PATTERNS) out = out.replaceAll(p.re, p.to);
  out = out.replaceAll(HTML_VALUE_ATTR_RE, replaceValueAttr);
  return out as PiiHintString;
}

export { redact, redact as redactHtml };
