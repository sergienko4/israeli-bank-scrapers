/**
 * Candidate scoping: rewrite SelectorCandidate values to constrain
 * resolution within a discovered form anchor.
 *
 * <p>Phase 12d split: extracted from {@link ../FormAnchor.ts}.
 */

import { type SelectorCandidate } from '../../../../Base/Config/LoginConfig.js';
import { escapeCssAttr, toXpathLiteral } from './AnchorEscape.js';
import { FORM_ID_RE, NON_FILLABLE_FILTER } from './AnchorTypes.js';

/**
 * Build a scoped CSS selector for a css-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The original candidate value.
 * @returns The scoped CSS selector string.
 */
function scopeCss(form: string, val: string): string {
  return `${form} ${val}`;
}

/**
 * Build a scoped CSS selector for a placeholder-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The placeholder text to match.
 * @returns The scoped CSS selector string.
 */
function scopePlaceholder(form: string, val: string): string {
  return `${form} input[placeholder*="${escapeCssAttr(val)}"]`;
}

/**
 * Build a scoped CSS selector for an ariaLabel-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The aria-label text to match.
 * @returns The scoped CSS selector string.
 */
function scopeAriaLabel(form: string, val: string): string {
  return `${form} input[aria-label="${escapeCssAttr(val)}"]`;
}

/**
 * Build a scoped CSS selector for a name-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The name attribute value to match.
 * @returns The scoped CSS selector string.
 */
function scopeName(form: string, val: string): string {
  return `${form} [name="${escapeCssAttr(val)}"]`;
}

/**
 * Pull the form id from a `#id` / `form#id` CSS selector, returning the
 * empty string when the selector is not in id-bearing shape.
 * @param form - Form anchor CSS selector.
 * @returns Form id, or '' when not parsable.
 */
function tryExtractFormId(form: string): string {
  const m = FORM_ID_RE.exec(form);
  return m ? m[1] : '';
}

/**
 * Build a scoped XPath expression for an xpath-kind candidate.
 *
 * <p>Converts the CSS form selector (e.g. `#otpLobbyFormPassword` or
 * `form#otpLobbyFormPassword`) into an XPath descendant predicate
 * (`//*[@id="otpLobbyFormPassword"]`) and prepends it so descendant
 * axes inside `val` are constrained to elements WITHIN the form.
 * Critical for multi-form lobbies where the same label text appears
 * in multiple forms (Isracard / Amex OTP vs password — issue #307).
 *
 * <p>If the CSS form selector is not an id-bearing shape, returns the
 * original xpath unchanged (no-op) — caller is responsible for picking
 * an id-stable form anchor whenever possible.
 * @param form - The form ancestor CSS selector.
 * @param val - The original xpath expression.
 * @returns The scoped xpath expression, or the original when not scopable.
 */
function scopeXpath(form: string, val: string): string {
  const formId = tryExtractFormId(form);
  if (!formId) return val;
  if (!val.startsWith('//')) return val;
  return `//*[@id="${formId}"]${val}`;
}

/**
 * Build a form-scoped XPath that mirrors `buildContainerInputXpath` from
 * {@link SelectorLabelStrategies.walkUp.ts} — searches for visible text
 * inside the form, then walks up to the closest container, then back
 * down to the first fillable input inside that container.
 *
 * <p>This rewrites a `textContent` candidate into a pre-baked scoped
 * xpath candidate so the strategy ladder's unscoped walk-up cannot
 * leak to a sibling form sharing the same label text (issue #307).
 * @param formId - Form id (already extracted).
 * @param val - Visible text value to search for.
 * @returns Scoped xpath string.
 */
function buildScopedTextContentXpath(formId: string, val: string): string {
  const scope = `//*[@id="${formId}"]`;
  const literal = toXpathLiteral(val);
  return (
    `${scope}//*[text()[contains(., ${literal})]]/` +
    `ancestor::*[.//input[${NON_FILLABLE_FILTER}]][1]//input[${NON_FILLABLE_FILTER}][1]`
  );
}

/**
 * Build a form-scoped XPath that locates a `<label>` (or div/span acting
 * as a label) inside the form and resolves the nearest fillable input
 * via nested OR sibling OR proximity walk — three xpath unions in one.
 *
 * <p>Mirrors `resolveLabelStrategies` from
 * {@link SelectorLabelStrategies.xpath.ts} but flattened into a single
 * xpath for use as a pre-baked scoped candidate (issue #307).
 * @param formId - Form id (already extracted).
 * @param val - Visible label text value.
 * @returns Scoped xpath string.
 */
function buildScopedLabelTextXpath(formId: string, val: string): string {
  const scope = `//*[@id="${formId}"]`;
  const label = `//label[contains(., ${toXpathLiteral(val)})]`;
  const nested = `${scope}${label}//input[${NON_FILLABLE_FILTER}][1]`;
  const sib = `${scope}${label}/following-sibling::input[${NON_FILLABLE_FILTER}][1]`;
  const proximity = `${scope}${label}/..//input[${NON_FILLABLE_FILTER}][1]`;
  return `${nested} | ${sib} | ${proximity}`;
}

/**
 * Build a form-scoped XPath for clickableText — finds the innermost
 * element whose own text contains the value, restricted to descendants
 * of the form.
 * @param formId - Form id (already extracted).
 * @param val - Visible text value.
 * @returns Scoped xpath string.
 */
function buildScopedClickableTextXpath(formId: string, val: string): string {
  const scope = `//*[@id="${formId}"]`;
  const literal = toXpathLiteral(val);
  return (
    `${scope}//*[not(self::script) and not(self::style) ` +
    `and contains(., ${literal}) and not(.//*[contains(., ${literal})])]`
  );
}

/** Builder fn for text-kind candidate-to-scoped-xpath conversion. */
type TextScopeBuilder = (formId: string, val: string) => string;

/** Map from text-kind to its scoped-xpath builder. */
const TEXT_SCOPE_BUILDERS: Partial<Record<SelectorCandidate['kind'], TextScopeBuilder>> = {
  textContent: buildScopedTextContentXpath,
  labelText: buildScopedLabelTextXpath,
  clickableText: buildScopedClickableTextXpath,
};

/**
 * Try to rewrite a text-kind candidate into a pre-baked form-scoped
 * xpath candidate. Returns the original candidate when the form
 * selector is not id-bearing (caller's preflight responsibility).
 * @param form - Form anchor CSS selector.
 * @param candidate - Original text-kind candidate.
 * @returns Rewritten xpath candidate, or original on no-op.
 */
function scopeTextCandidate(form: string, candidate: SelectorCandidate): SelectorCandidate {
  const builder = TEXT_SCOPE_BUILDERS[candidate.kind];
  if (!builder) return candidate;
  const formId = tryExtractFormId(form);
  if (!formId) return candidate;
  // Spread `candidate` first so `target` / `match` hints carry through the
  // text→xpath rewrite (parity with `scopeCssCandidate` / xpath branches —
  // CR PR #345 outside-diff finding).
  return { ...candidate, kind: 'xpath', value: builder(formId, candidate.value) };
}

/** Map from scopable kind to a function that builds the scoped CSS value. */
const SCOPE_BUILDERS: Partial<
  Record<SelectorCandidate['kind'], (form: string, val: string) => string>
> = {
  css: scopeCss,
  placeholder: scopePlaceholder,
  ariaLabel: scopeAriaLabel,
  name: scopeName,
};

/**
 * Build the CSS branch of a scoped candidate via {@link SCOPE_BUILDERS}.
 * Returns the candidate unchanged when no builder is registered for
 * the candidate kind.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidate - Candidate to scope (non-xpath, non-text kinds).
 * @returns Scoped CSS candidate or the input candidate untouched.
 */
function scopeCssCandidate(formSelector: string, candidate: SelectorCandidate): SelectorCandidate {
  const builder = SCOPE_BUILDERS[candidate.kind];
  if (!builder) return candidate;
  return { ...candidate, kind: 'css', value: builder(formSelector, candidate.value) };
}

/**
 * Scope a selector candidate to search within a form element.
 *
 * <p>Dispatch order:
 * 1. `xpath` kind — prepend `//*[@id="X"]` ancestor predicate
 * 2. `textContent` / `labelText` / `clickableText` — rewrite into
 *    pre-baked scoped xpath (mirrors strategy walk-up, but pinned
 *    inside the form anchor) — critical for multi-form lobbies
 *    where the same visible text exists in OTP + password forms
 *    (Isracard / Amex — issue #307).
 * 3. `css` / `placeholder` / `ariaLabel` / `name` — prepend form
 *    descendant via {@link SCOPE_BUILDERS}.
 * 4. Anything else — returned unchanged.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidate - The original selector candidate.
 * @returns A form-scoped copy of the candidate, or the original if not scopable.
 */
export function scopeCandidate(
  formSelector: string,
  candidate: SelectorCandidate,
): SelectorCandidate {
  if (candidate.kind === 'xpath') {
    return { ...candidate, kind: 'xpath', value: scopeXpath(formSelector, candidate.value) };
  }
  if (TEXT_SCOPE_BUILDERS[candidate.kind]) return scopeTextCandidate(formSelector, candidate);
  return scopeCssCandidate(formSelector, candidate);
}

/**
 * Create form-scoped versions of all candidates in an array.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidates - The original selector candidates.
 * @returns An array of form-scoped candidates.
 */
export function scopeCandidates(
  formSelector: string,
  candidates: SelectorCandidate[],
): SelectorCandidate[] {
  return candidates.map((c): SelectorCandidate => scopeCandidate(formSelector, c));
}
