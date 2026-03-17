import { type Frame, type Page } from 'playwright-core';

import { getDebug } from './Debug.js';

const LOG = getDebug('selector-label');

/** XPath union of elements that can visually label an input field. */
const LABEL_TAGS = 'self::label or self::div or self::span';

/** A function that checks element existence with a timeout. */
export type QueryFn = (context: Page | Frame, css: string) => Promise<boolean>;

/**
 * Check whether a resolved element is a fillable input (not hidden/submit/button).
 * @param ctx - The Playwright Page or Frame containing the element.
 * @param selector - CSS or XPath selector for the element to check.
 * @returns True if the element is a fillable input or textarea.
 */
export async function isFillableInput(ctx: Page | Frame, selector: string): Promise<boolean> {
  const loc = ctx.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = (await loc.getAttribute('type')) ?? 'text';
  return (
    type !== 'hidden' &&
    type !== 'submit' &&
    type !== 'button' &&
    type !== 'radio' &&
    type !== 'checkbox'
  );
}

/**
 * Find the input element referenced by a label's for attribute.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param forAttr - The for attribute value from the label.
 * @param labelValue - The visible label text (for diagnostic logging).
 * @returns The CSS selector for the input, or empty string if not found.
 */
export async function findInputByForAttr(
  ctx: Page | Frame,
  forAttr: string,
  labelValue: string,
): Promise<string> {
  const inputSelector = `#${forAttr}`;
  if ((await ctx.locator(inputSelector).count()) === 0) {
    LOG.debug('labelText "%s" for="%s" but #%s not found', labelValue, forAttr, forAttr);
    return '';
  }
  LOG.debug('resolved labelText "%s" → for="%s" → %s', labelValue, forAttr, inputSelector);
  return inputSelector;
}

/** Options for xpath-based input resolution strategies. */
interface IXpathStrategyOpts {
  ctx: Page | Frame;
  baseXpath: string;
  queryFn: QueryFn;
}

/**
 * Strategy 2: find an input nested inside the labeling element.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the nested input, or empty string if not found.
 */
export async function resolveByNestedInput(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}//input[1]`;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isFillable = await isFillableInput(ctx, xpath);
  if (!isFillable) return '';
  LOG.debug('resolved labelText → nested input via %s', baseXpath);
  return xpath;
}

/** Nullable string result from DOM attribute lookups — matches Playwright ElementHandle API. */
type NullableAttrResult = Promise<string | null>;

/** A DOM element handle that supports getting attribute values. */
interface ILabelHandle {
  /** Retrieve an HTML attribute by name. */
  getAttribute: (name: string) => NullableAttrResult;
}

/** Options for aria-based input resolution. */
interface IAriaRefOpts {
  ctx: Page | Frame;
  label: ILabelHandle;
  labelValue: string;
  queryFn: QueryFn;
}

/**
 * Strategy 3: labeling element has id — find input with aria-labelledby matching that id.
 * @param opts - The aria reference resolution options.
 * @returns The CSS selector for the aria-referenced input, or empty string if not found.
 */
export async function resolveByAriaRef(opts: IAriaRefOpts): Promise<string> {
  const { ctx, label, labelValue, queryFn } = opts;
  const labelId = await label.getAttribute('id');
  if (!labelId) return '';
  const selector = `input[aria-labelledby="${labelId}"]`;
  const isFound = await queryFn(ctx, selector);
  if (!isFound) return '';
  LOG.debug('resolved labelText "%s" → aria-labelledby="%s"', labelValue, labelId);
  return selector;
}

/**
 * Strategy 4: labeling element followed by a sibling input.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the sibling input, or empty string if not found.
 */
export async function resolveBySibling(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/following-sibling::input[1]`;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isFillable = await isFillableInput(ctx, xpath);
  if (!isFillable) return '';
  LOG.debug('resolved labelText → sibling input via %s', baseXpath);
  return xpath;
}

/**
 * Strategy 5: nearest input in the same parent container.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the proximity input, or empty string if not found.
 */
export async function resolveByProximity(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/..//input[1]`;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isFillable = await isFillableInput(ctx, xpath);
  if (!isFillable) return '';
  LOG.debug('resolved labelText → proximity input via %s', baseXpath);
  return xpath;
}

/** Inputs for label-based input resolution strategies. */
export interface ILabelStrategyOpts {
  ctx: Page | Frame;
  label: ILabelHandle;
  baseXpath: string;
  labelValue: string;
  queryFn: QueryFn;
}

/**
 * Try label-based resolution (for-attr, then nesting/ariaRef/sibling/proximity/walk-up).
 * @param opts - The label resolution options.
 * @returns The resolved CSS/XPath selector, or empty string if no strategy matched.
 */
export async function resolveLabelStrategies(opts: ILabelStrategyOpts): Promise<string> {
  const { ctx, label, baseXpath, labelValue, queryFn } = opts;
  const forAttr = await label.getAttribute('for');
  if (forAttr) return findInputByForAttr(ctx, forAttr, labelValue);
  const nestedResult = await resolveByNestedInput({ ctx, baseXpath, queryFn });
  if (nestedResult) return nestedResult;
  const ariaResult = await resolveByAriaRef({ ctx, label, labelValue, queryFn });
  if (ariaResult) return ariaResult;
  const siblingResult = await resolveBySibling({ ctx, baseXpath, queryFn });
  if (siblingResult) return siblingResult;
  return resolveByProximity({ ctx, baseXpath, queryFn });
}

/** XPath filter to exclude hidden, submit, and button inputs. */
const NON_FILLABLE_FILTER =
  'not(@type="hidden") and not(@type="submit") and not(@type="button") and not(@type="radio") and not(@type="checkbox")';

/** Interactive ancestor tags that a text node can walk up to. */
const INTERACTIVE_ANCESTORS = ['button', 'a', 'select'] as const;

/**
 * Strategy 6: find text node, walk up to nearest container with a fillable input.
 * Broader than proximity — searches all ancestors, not just the immediate parent.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The XPath selector for the container input, or empty string if not found.
 */
export async function resolveByContainerInput(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  const xpath =
    `xpath=//*[text()[contains(., "${textValue}")]]/` +
    `ancestor::*[.//input[${NON_FILLABLE_FILTER}]][1]//input[${NON_FILLABLE_FILTER}][1]`;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isOk = await isFillableInput(ctx, xpath);
  if (!isOk) return '';
  LOG.debug('textContent "%s" → container input walk-up', textValue);
  return xpath;
}

/** Options for building an ancestor probe action. */
interface IAncestorProbeOpts {
  ctx: Page | Frame;
  textValue: string;
  queryFn: QueryFn;
}

/**
 * Build a lazy action that probes a single ancestor tag for a text value.
 * @param opts - The ancestor probe options.
 * @param tag - The HTML tag name to search for.
 * @returns An async function that resolves to a selector or empty string.
 */
function buildAncestorProbe(opts: IAncestorProbeOpts, tag: string): () => Promise<string> {
  return async () => {
    const xpath = `xpath=//${tag}[.//text()[contains(., "${opts.textValue}")]]`;
    const isFound = await opts.queryFn(opts.ctx, xpath);
    if (!isFound) return '';
    LOG.debug('textContent "%s" → walk-up to <%s>', opts.textValue, tag);
    return xpath;
  };
}

/**
 * Walk up from a text node to find the nearest interactive ancestor (button, a, select).
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The XPath selector for the interactive ancestor, or empty string if not found.
 */
export async function resolveByAncestorWalkUp(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  const opts: IAncestorProbeOpts = { ctx, textValue, queryFn };
  const actions = INTERACTIVE_ANCESTORS.map(tag => buildAncestorProbe(opts, tag));
  const emptyPromise = Promise.resolve('');
  return actions.reduce<Promise<string>>(async (prev, action) => {
    const found = await prev;
    if (found) return found;
    const next = await action();
    return next;
  }, emptyPromise);
}

/**
 * Resolve a textContent candidate: find text anywhere, walk up to interactive element or nearby input.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The resolved selector, or empty string if not found.
 */
export async function resolveTextContent(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  const interactive = await resolveByAncestorWalkUp(ctx, textValue, queryFn);
  if (interactive) return interactive;
  return resolveByContainerInput(ctx, textValue, queryFn);
}

/**
 * Build a strict XPath for div/span: matches only elements whose OWN text
 * (not nested children) contains the value. Prevents matching large containers.
 * @param value - The text content to match against.
 * @returns An XPath selector string.
 */
export function divSpanStrictXpath(value: string): string {
  return `xpath=//*[${LABEL_TAGS}][text()[contains(., "${value}")]]`;
}

/** Options for resolving a labelText candidate. */
interface IResolveLabelTextOpts {
  ctx: Page | Frame;
  labelXpath: string;
  labelValue: string;
  queryFn: QueryFn;
}

/**
 * Resolve a labelText candidate: try label first, then div/span with strict text.
 * @param opts - The label text resolution options.
 * @returns The resolved input selector, or empty string if no resolution succeeded.
 */
export async function resolveLabelText(opts: IResolveLabelTextOpts): Promise<string> {
  const { ctx, labelXpath, labelValue, queryFn } = opts;
  const labelLoc = ctx.locator(labelXpath).first();
  if ((await labelLoc.count()) > 0) {
    const labelOpts = { ctx, label: labelLoc, baseXpath: labelXpath, labelValue, queryFn };
    return resolveLabelStrategies(labelOpts);
  }
  const strictXpath = divSpanStrictXpath(labelValue);
  const divSpanLoc = ctx.locator(strictXpath).first();
  if ((await divSpanLoc.count()) === 0) return '';
  LOG.debug('labelText "%s" found via div/span fallback', labelValue);
  return resolveLabelStrategies({
    ctx,
    label: divSpanLoc,
    baseXpath: strictXpath,
    labelValue,
    queryFn,
  });
}
