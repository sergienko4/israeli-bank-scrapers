import { type Frame, type Page } from 'playwright-core';

import { type SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { type Nullable } from '../../../Base/Interfaces/CallbackTypes.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';

const LOG = getDebug(import.meta.url);

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/** A cached form element discovered from a resolved input field. */
export interface IFormAnchor {
  /** CSS selector uniquely identifying the form element. */
  selector: string;
  /** The Playwright context (Page or Frame) containing the form. */
  context: Page | Frame;
}

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
  return `${form} input[placeholder*="${val}"]`;
}

/**
 * Build a scoped CSS selector for an ariaLabel-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The aria-label text to match.
 * @returns The scoped CSS selector string.
 */
function scopeAriaLabel(form: string, val: string): string {
  return `${form} input[aria-label="${val}"]`;
}

/**
 * Build a scoped CSS selector for a name-kind candidate.
 * @param form - The form ancestor CSS selector.
 * @param val - The name attribute value to match.
 * @returns The scoped CSS selector string.
 */
function scopeName(form: string, val: string): string {
  return `${form} [name="${val}"]`;
}

/** Regex extracting the form id from a `#id` or `form#id` CSS selector. */
const FORM_ID_RE = /^[a-z]*#([\w-]+)$/i;

/**
 * XPath filter excluding non-fillable input types — mirrors the constant
 * defined in {@link SelectorLabelStrategies.walkUp.ts}. Inlined here to
 * keep this module self-contained for form-scoped candidate rewrites.
 */
const NON_FILLABLE_FILTER =
  'not(@type="hidden") and not(@type="submit") and not(@type="button") ' +
  'and not(@type="radio") and not(@type="checkbox")';

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
  return (
    `${scope}//*[text()[contains(., "${val}")]]/` +
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
  const label = `//label[contains(., "${val}")]`;
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
  return (
    `${scope}//*[not(self::script) and not(self::style) ` +
    `and contains(., "${val}") and not(.//*[contains(., "${val}")])]`
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
  return { kind: 'xpath', value: builder(formId, candidate.value) };
}

/** Map from scopable kind to a function that builds the scoped CSS value. */
const SCOPE_BUILDERS: Record<string, (form: string, val: string) => string> = {
  css: scopeCss,
  placeholder: scopePlaceholder,
  ariaLabel: scopeAriaLabel,
  name: scopeName,
};

/**
 * Run the form-walk: collect ancestor metadata in browser, then find form-like in Node.
 * Two-phase approach: browser evaluate returns metadata array, Node finds and builds selector.
 * @param ctx - The Page or Frame containing the input.
 * @param resolvedSelector - CSS/XPath selector for the already-resolved input.
 * @returns The form CSS selector, or empty string if not found.
 */
async function evaluateFormWalk(ctx: Page | Frame, resolvedSelector: string): Promise<string> {
  const loc = ctx.locator(resolvedSelector).first();
  if ((await loc.count()) === 0) return '';
  const ancestors = await collectAncestorMeta(ctx, resolvedSelector);
  // Prefer the actual `<form>` element over wrapper divs that happen to contain
  // 2+ inputs. The wrapper-DIV scope often includes header nav elements that
  // share aria-labels with form controls (e.g. Max's `<a aria-label="כניסה">`
  // sibling to the form's submit button) — scoping to the form itself excludes
  // those and produces unambiguous click resolution.
  const formTag = ancestors.find((m): boolean => m.isForm);
  const fallback = ancestors.find((m): boolean => m.fillCount >= MIN_FILLABLE_INPUTS);
  const formAncestor = formTag ?? fallback;
  if (!formAncestor) return '';
  return buildSelectorFromMeta(formAncestor);
}

/** Metadata for a single ancestor element — transferred from browser to Node. */
interface IAncestorMeta {
  readonly tag: string;
  readonly id: string;
  readonly isForm: boolean;
  readonly fillCount: number;
  readonly sibIndex: number;
  readonly sibCount: number;
  readonly name: string;
  readonly stableClass: string;
}

/** Ancestor tuple: [tag, id, isForm, fillCount, sibIndex, sibCount, name, stableClass]. */
type AncestorTuple = [string, string, boolean, number, number, number, string, string];

/**
 * Convert a raw ancestor tuple from browser evaluate into typed metadata.
 * @param t - The raw tuple.
 * @returns Typed ancestor metadata.
 */
function tupleToMeta(t: AncestorTuple): IAncestorMeta {
  return {
    tag: t[0],
    id: t[1],
    isForm: t[2],
    fillCount: t[3],
    sibIndex: t[4],
    sibCount: t[5],
    name: t[6],
    stableClass: t[7],
  };
}

/** XPath expression for ancestors, excluding html and body. */
const ANCESTOR_XPATH = 'xpath=ancestor::*[not(self::html) and not(self::body)]';

/**
 * Walk up from an element collecting all ancestor metadata.
 * Uses Playwright locator.evaluateAll with fully inline callback.
 * @param ctx - The Page or Frame to evaluate in.
 * @param selector - CSS/XPath selector for the starting element.
 * @returns Array of typed ancestor metadata from nearest to farthest.
 */
async function collectAncestorMeta(ctx: Page | Frame, selector: string): Promise<IAncestorMeta[]> {
  const ancestorLoc = ctx.locator(selector).first().locator(ANCESTOR_XPATH);
  if ((await ancestorLoc.count()) === 0) return [];
  const tuples = await ancestorLoc.evaluateAll(mapAncestorTuples);
  const reversed = [...tuples];
  reversed.reverse();
  return reversed.map(tupleToMeta);
}

/**
 * Browser-context: map ancestor elements to metadata tuples.
 * Self-contained — Playwright serializes only this function.
 * @param els - Array of ancestor DOM elements.
 * @returns Array of ancestor tuples.
 */
function mapAncestorTuples(els: Element[]): AncestorTuple[] {
  return els.map((el): AncestorTuple => {
    const p = el.parentElement;
    const sibs = p ? [...p.children].filter((c): boolean => c.tagName === el.tagName) : null;
    // `String()` is the empty-string sentinel for "absent" attributes;
    // downstream `extractFormAnchorSelector` treats zero-length values as "not present".
    const absent = String();
    const filtered = el.className.split(/\s+/).filter((c): boolean => c.length > 0);
    const stableClass = filtered.find((c): boolean => !c.startsWith('ng-')) ?? absent;
    return [
      el.tagName,
      el.id,
      el.tagName === 'FORM',
      el.querySelectorAll('input').length,
      sibs ? sibs.indexOf(el) + 1 : 1,
      sibs?.length ?? 1,
      el.getAttribute('name') ?? absent,
      stableClass,
    ];
  });
}

/** Minimum fillable input count to consider a non-form element as form-like. */
const MIN_FILLABLE_INPUTS = 2;

/**
 * Build a CSS selector from ancestor metadata. Preference order (most to
 * least stable):
 *   1. `#id`             — explicit id
 *   2. `tag[name="X"]`   — name attribute (form/input common)
 *   3. `tag.classX`      — first non-Angular class (e.g. Max's `.user-login-form`)
 *   4. `tag:nth-of-type` — positional fallback (Discount-style; intentionally
 *      LAST because it is fragile and historically caused regressions)
 *   5. `tag` alone — only when single sibling and no other identifier
 * The downstream `extractFormAnchorSelector` guard accepts options 1–3 only;
 * positional/tag-only selectors are rejected to avoid the "div:nth-of-type(0)"
 * trap. This function emits the BEST AVAILABLE selector regardless of trust;
 * the trust filter happens at the caller.
 * @param meta - The ancestor metadata.
 * @returns A CSS selector string.
 */
function buildSelectorFromMeta(meta: IAncestorMeta): string {
  if (meta.id) return '#' + meta.id;
  const tag = meta.tag.toLowerCase();
  if (meta.name.length > 0) return tag + '[name="' + meta.name + '"]';
  if (meta.stableClass.length > 0) return tag + '.' + meta.stableClass;
  if (meta.sibCount <= 1) return tag;
  return tag + ':nth-of-type(' + String(meta.sibIndex) + ')';
}

/**
 * From a resolved input element, walk up the DOM to find the nearest form.
 * Looks for a form tag first, then any container with 2+ fillable inputs.
 * @param ctx - The Page or Frame containing the resolved input.
 * @param resolvedSelector - The CSS/XPath selector for the already-resolved input.
 * @returns A form anchor with a unique selector, or Nullable when no form found.
 */
export async function discoverFormAnchor(
  ctx: Page | Frame,
  resolvedSelector: string,
): Promise<Nullable<IFormAnchor>> {
  const formSelector = await evaluateFormWalk(ctx, resolvedSelector);
  if (!formSelector) return EMPTY_RESULT;
  LOG.debug({
    message: `discovered form anchor: ${maskVisibleText(formSelector)}`,
  });
  return { selector: formSelector, context: ctx };
}

/**
 * Build the CSS branch of a scoped candidate via {@link SCOPE_BUILDERS}.
 * Returns the candidate unchanged when no builder is registered for
 * the candidate kind.
 * @param formSelector - The CSS selector for the form anchor.
 * @param candidate - Candidate to scope (non-xpath, non-text kinds).
 * @returns Scoped CSS candidate or the input candidate untouched.
 */
function scopeCssCandidate(formSelector: string, candidate: SelectorCandidate): SelectorCandidate {
  const builder = SCOPE_BUILDERS[candidate.kind] as
    | ((form: string, val: string) => string)
    | undefined;
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
