/**
 * Selector-injection guards for form-anchor construction.
 *
 * <p>The form-walk pulls `id`, `name`, and `class` directly from the
 * page DOM (`AnchorWalk.mapAncestorTuples`) and the candidate
 * scoping path inlines user-config values (`AnchorScope.scope*`).
 * Both are attacker-influenceable surfaces — without escaping, a
 * DOM `id="x\"][onerror=…"` payload or a config-supplied label of
 * `\"); fetch(…); ("` would silently land inside a CSS/XPath
 * literal and break selector resolution at best, exfiltrate at
 * worst. Per `coding-principle §7` (INJECTION PREVENTION) and CR
 * PR #345 findings #175 + #179, every dynamic CSS / attribute /
 * XPath literal MUST flow through one of the helpers below.
 *
 * <p>Phase 12d hardening: added 2026-06-14 to close CR PR #345
 * findings #175 (AnchorScope) + #179 (AnchorWalk).
 */

/** Regex for CSS identifier metacharacters (any char outside [A-Za-z0-9_-]). */
const CSS_IDENT_UNSAFE = /[^\w-]/g;

/** Regex for double quotes — the attribute-value delimiter we use throughout. */
const ATTR_QUOTE = /"/g;

/** Regex for backslashes — must be escaped first to avoid double-escaping. */
const BACKSLASH = /\\/g;

/**
 * Nominal brand for a CSS-identifier-safe string. Carries the same
 * runtime value as `string`; the `__brand` field exists only in the
 * type system. Satisfies Rule #15 ("no primitive returns at module
 * boundaries") per `Pipeline/Types/Brand.ts` pattern.
 */
export type CssIdent = string & { readonly __brand: 'CssIdent' };

/** Nominal brand for a CSS attribute-value-safe string. */
export type CssAttr = string & { readonly __brand: 'CssAttr' };

/** Nominal brand for a complete XPath string literal expression. */
export type XPathLiteral = string & { readonly __brand: 'XPathLiteral' };

/**
 * Escape a value used as a CSS identifier (id, class, tag suffix).
 *
 * <p>Prefers the browser-native `CSS.escape` when available (jsdom
 * + Playwright contexts both ship it); falls back to a regex-based
 * `\` + hex escape for the unsafe characters when running under a
 * stripped runtime (Jest unit harness without DOM polyfill).
 * @param raw - Untrusted identifier string (e.g. DOM `id` attribute).
 * @returns CSS-safe identifier (every non-ident char becomes `\HH`).
 */
export function escapeCssIdent(raw: string): CssIdent {
  const cssEscape = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  if (cssEscape) return cssEscape(raw) as CssIdent;
  const replaced = raw.replaceAll(CSS_IDENT_UNSAFE, (ch): string => {
    const cp = ch.codePointAt(0) ?? 0;
    return `\\${cp.toString(16)} `;
  });
  return replaced as CssIdent;
}

/**
 * Escape a value used inside a CSS attribute selector
 * (e.g. `[name="…"]`, `[placeholder*="…"]`).
 *
 * <p>The CSS attribute-value grammar requires `\` and `"` to be
 * backslash-escaped; we escape backslashes FIRST so a literal `\`
 * does not become a leading escape after the quote pass.
 * @param raw - Untrusted attribute-value string.
 * @returns Value safe to interpolate between double-quote delimiters.
 */
export function escapeCssAttr(raw: string): CssAttr {
  const out = raw.replaceAll(BACKSLASH, '\\\\').replaceAll(ATTR_QUOTE, String.raw`\"`);
  return out as CssAttr;
}

/**
 * Convert a string into an XPath string literal that quotes any
 * embedded single OR double quotes safely.
 *
 * <p>XPath has no escape character inside a string literal — the
 * canonical workaround is `concat('a', "'", 'b')` when both quote
 * styles appear. This helper picks `"…"` when the value contains
 * no `"`, `'…'` when it contains no `'`, and `concat(...)` when
 * both appear. Without this, an attacker-controlled label of
 * `"); evil(("` would break out of the literal.
 * @param raw - Untrusted text value to embed in an XPath expression.
 * @returns XPath literal expression (already quoted; do NOT add quotes).
 */
export function toXpathLiteral(raw: string): XPathLiteral {
  if (!raw.includes('"')) return `"${raw}"` as XPathLiteral;
  if (!raw.includes("'")) return `'${raw}'` as XPathLiteral;
  const parts = raw.split('"').map((segment): string => `"${segment}"`);
  return `concat(${parts.join(", '\"', ")})` as XPathLiteral;
}
