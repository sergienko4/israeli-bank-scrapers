import { type Frame, type Page } from 'playwright';

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
  const tagName = await ctx.$eval(selector, (el: Element) => el.tagName.toLowerCase());
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = await ctx.$eval(selector, (el: Element) => el.getAttribute('type') ?? 'text');
  return type !== 'hidden' && type !== 'submit' && type !== 'button';
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
  if (!(await ctx.$(inputSelector))) {
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
 * Try label-based resolution (for-attr, then nesting/ariaRef/sibling/proximity).
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
  const label = await ctx.$(labelXpath);
  if (label) {
    return resolveLabelStrategies({ ctx, label, baseXpath: labelXpath, labelValue, queryFn });
  }
  const strictXpath = divSpanStrictXpath(labelValue);
  const divSpan = await ctx.$(strictXpath);
  if (!divSpan) return '';
  LOG.debug('labelText "%s" found via div/span fallback', labelValue);
  return resolveLabelStrategies({
    ctx,
    label: divSpan,
    baseXpath: strictXpath,
    labelValue,
    queryFn,
  });
}
