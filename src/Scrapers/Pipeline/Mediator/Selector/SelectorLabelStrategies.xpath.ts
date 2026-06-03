/**
 * XPath label strategies: nested input, aria-labelledby, sibling, proximity,
 * and div/span strict-text fallbacks. Also hosts the orchestration entries
 * `resolveLabelStrategies` and `resolveLabelText`.
 */

import type { Frame, Page } from 'playwright-core';

import { maskVisibleText } from '../../Types/LogEvent.js';
import { findInputByForAttr } from './SelectorLabelStrategies.forAttr.js';
import { logField, logMsg, probeFillableLogField } from './SelectorLabelStrategies.logging.js';
import type {
  DivSpanStrictXpath,
  IAriaRefOpts,
  ILabelStrategyOpts,
  IResolveLabelTextOpts,
  IXpathStrategyOpts,
} from './SelectorLabelStrategies.types.js';
import { NON_FILLABLE_FILTER } from './SelectorLabelStrategies.walkUp.js';

/** XPath union of elements that can visually label an input field. */
const LABEL_TAGS = 'self::label or self::div or self::span';

/**
 * Strategy 2: find an input nested inside the labeling element.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the nested input, or '' if not found.
 */
async function resolveByNestedInput(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}//input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:nested' });
}

/**
 * Strategy 3: labeling element has id — find input with aria-labelledby.
 * @param opts - The aria reference resolution options.
 * @returns The CSS selector for the aria-referenced input, or '' if not found.
 */
async function resolveByAriaRef(opts: IAriaRefOpts): Promise<string> {
  const { ctx, label, labelValue, queryFn } = opts;
  const labelId = await label.getAttribute('id');
  if (!labelId) return '';
  const selector = `input[aria-labelledby="${labelId}"]`;
  const isFound = await queryFn(ctx, selector);
  if (!isFound) return '';
  logField(`labelText:${maskVisibleText(labelValue)}`, 'FOUND');
  return selector;
}

/**
 * Strategy 4: labeling element followed by a sibling input.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the sibling input, or '' if not found.
 */
async function resolveBySibling(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/following-sibling::input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:sibling' });
}

/**
 * Strategy 5: nearest input in the same parent container.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the proximity input, or '' if not found.
 */
async function resolveByProximity(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/..//input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:proximity' });
}

/**
 * Run the xpath/aria strategies in fallback order: nested → aria → sibling → proximity.
 * @param opts - The label resolution options.
 * @returns The resolved selector, or '' when all four strategies miss.
 */
async function tryXpathStrategiesFallback(opts: ILabelStrategyOpts): Promise<string> {
  const { ctx, label, baseXpath, labelValue, queryFn } = opts;
  const nested = await resolveByNestedInput({ ctx, baseXpath, queryFn });
  if (nested) return nested;
  const aria = await resolveByAriaRef({ ctx, label, labelValue, queryFn });
  if (aria) return aria;
  const sibling = await resolveBySibling({ ctx, baseXpath, queryFn });
  if (sibling) return sibling;
  return resolveByProximity({ ctx, baseXpath, queryFn });
}

/**
 * Try label-based resolution (for-attr, then nesting/ariaRef/sibling/proximity).
 * @param opts - The label resolution options.
 * @returns The resolved CSS/XPath selector, or '' if no strategy matched.
 */
async function resolveLabelStrategies(opts: ILabelStrategyOpts): Promise<string> {
  const forAttr = await opts.label.getAttribute('for');
  if (forAttr) return findInputByForAttr(opts.ctx, forAttr, opts.labelValue);
  return tryXpathStrategiesFallback(opts);
}

/**
 * Build a strict XPath for div/span: matches only elements whose OWN text
 * (not nested children) contains the value.
 * @param value - The text content to match against.
 * @returns An XPath selector string.
 */
function divSpanStrictXpath(value: string): DivSpanStrictXpath {
  return `xpath=//*[${LABEL_TAGS}][text()[contains(., "${value}")]]` as DivSpanStrictXpath;
}

/**
 * Locate the first matching label via the supplied xpath.
 * @param ctx - Page or Frame.
 * @param labelXpath - XPath identifying the label element.
 * @returns Promise resolving to true when at least one element exists.
 */
async function hasMatch(ctx: Page | Frame, labelXpath: string): Promise<boolean> {
  return (await ctx.locator(labelXpath).count()) > 0;
}

/**
 * Try the direct label-locator path first.
 * @param opts - The label text resolution options.
 * @returns Resolved selector or `false` when no direct label was found.
 */
async function tryDirectLabel(opts: IResolveLabelTextOpts): Promise<string | false> {
  const { ctx, labelXpath, labelValue, queryFn } = opts;
  const isExisting = await hasMatch(ctx, labelXpath);
  if (!isExisting) return false;
  const label = ctx.locator(labelXpath).first();
  return resolveLabelStrategies({ ctx, label, baseXpath: labelXpath, labelValue, queryFn });
}

/**
 * Build the label-strategy invocation for the div/span fallback path.
 * @param opts - The label text resolution options.
 * @param strictXpath - The div/span strict xpath.
 * @returns Resolved input selector or ''.
 */
async function runDivSpanStrategies(
  opts: IResolveLabelTextOpts,
  strictXpath: DivSpanStrictXpath,
): Promise<string> {
  const { ctx, labelValue, queryFn } = opts;
  const label = ctx.locator(strictXpath).first();
  return resolveLabelStrategies({ ctx, label, baseXpath: strictXpath, labelValue, queryFn });
}

/**
 * Fallback: search div/span elements with strict text match, then run
 * the same label-strategy ladder against them.
 * @param opts - The label text resolution options.
 * @returns Resolved selector or '' when no div/span matched.
 */
async function tryDivSpanFallback(opts: IResolveLabelTextOpts): Promise<string> {
  const strictXpath = divSpanStrictXpath(opts.labelValue);
  const isExisting = await hasMatch(opts.ctx, strictXpath);
  if (!isExisting) return '';
  logMsg(`labelText "${maskVisibleText(opts.labelValue)}" found via div/span fallback`);
  return runDivSpanStrategies(opts, strictXpath);
}

/**
 * Resolve a labelText candidate: try label first, then div/span with strict text.
 * @param opts - The label text resolution options.
 * @returns The resolved input selector, or '' if no resolution succeeded.
 */
async function resolveLabelText(opts: IResolveLabelTextOpts): Promise<string> {
  const direct = await tryDirectLabel(opts);
  if (direct !== false) return direct;
  return tryDivSpanFallback(opts);
}

export {
  divSpanStrictXpath,
  resolveByAriaRef,
  resolveByNestedInput,
  resolveByProximity,
  resolveBySibling,
  resolveLabelStrategies,
  resolveLabelText,
};
