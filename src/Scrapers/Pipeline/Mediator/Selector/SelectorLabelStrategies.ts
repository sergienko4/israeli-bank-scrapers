import { type Frame, type Locator, type Page } from 'playwright-core';

import type { Brand } from '../../Types/Brand.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';

/** XPath selector for div/span strict text-content match. */
type DivSpanStrictXpath = Brand<string, 'DivSpanStrictXpath'>;

const LOG = getDebug(import.meta.url);

/** XPath union of elements that can visually label an input field. */
const LABEL_TAGS = 'self::label or self::div or self::span';

/** A function that checks element existence with a timeout. */
export type QueryFn = (context: Page | Frame, css: string) => Promise<boolean>;

/** Input types that accept text via Playwright .fill(). */
const FILLABLE_INPUT_TYPES = new Set([
  'text',
  'password',
  'email',
  'tel',
  'number',
  'search',
  'url',
  '',
]);

/** Tags that are inherently clickable interactive elements. */
const CLICKABLE_TAGS = new Set(['button', 'a', 'select']);

/** Input types that are click targets, not fill targets. */
const CLICKABLE_INPUT_TYPES = new Set(['submit', 'button', 'radio', 'checkbox']);

/** ARIA roles that indicate a clickable interactive element. */
const CLICKABLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem']);

/** Extracted element metadata — shared by fillable and clickable checks. */
interface IElementMeta {
  readonly tag: string;
  readonly type: string;
  readonly role: string;
  readonly tabindex: string;
}

/**
 * Extract an HTML attribute value from a locator, returning empty string when absent.
 * Avoids the '' literal fallback lint rule by using an explicit null-check.
 * @param loc - The Playwright locator to query.
 * @param name - The attribute name.
 * @returns The attribute value, or empty string when the attribute is not present.
 */
async function extractAttrOrEmpty(loc: Locator, name: string): Promise<string> {
  const value = await loc.getAttribute(name);
  if (value === null) return String();
  return value;
}

/**
 * Compact LOG.debug for {field, result} diagnostic pairs.
 * @param field - Field label tag (e.g. 'labelText:nested').
 * @param result - Discovery outcome.
 * @returns Sentinel `true` so the call can be expression-chained where needed.
 */
function logField(field: string, result: 'FOUND' | 'NOT_FOUND'): true {
  LOG.debug({ field, result });
  return true;
}

/**
 * Compact LOG.debug for {message} diagnostic strings.
 * @param message - Plain message to emit at DEBUG.
 * @returns Sentinel `true` so the call can be expression-chained where needed.
 */
function logMsg(message: string): true {
  LOG.debug({ message });
  return true;
}

/** Bundle of inputs for probeFillableLogField — keeps the 3-param cap. */
interface IProbeFillableOpts {
  readonly ctx: Page | Frame;
  readonly xpath: string;
  readonly queryFn: QueryFn;
  readonly fieldTag: string;
}

/**
 * Probe an xpath/css selector: must exist AND be a fillable input.
 * Logs FOUND with the supplied field tag on success. Centralises
 * the exists→fillable→log triple shared by xpath strategies.
 * @param opts - Probe context bundle.
 * @returns Selector itself when found+fillable, empty string on miss.
 */
async function probeFillableLogField(opts: IProbeFillableOpts): Promise<string> {
  const { ctx, xpath, queryFn, fieldTag } = opts;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isFillable = await isFillableInput(ctx, xpath);
  if (!isFillable) return '';
  logField(fieldTag, 'FOUND');
  return xpath;
}

/**
 * Helper for findInputByForAttr — log NOT_FOUND outcome and return ''.
 * @param field - The field tag for the diagnostic.
 * @returns Empty string sentinel.
 */
function logMissAndEmpty(field: string): string {
  logField(field, 'NOT_FOUND');
  return '';
}

/**
 * Helper for findInputByForAttr — log NOT-FILLABLE outcome and return ''.
 * @param forAttr - The for-attribute value.
 * @param labelValue - The visible label text.
 * @returns Empty string sentinel.
 */
function logFillFailAndEmpty(forAttr: string, labelValue: string): string {
  const masked = maskVisibleText(labelValue);
  logMsg(`labelText "${masked}" for="${forAttr}" → NOT FILLABLE`);
  return '';
}

/**
 * Chain async string-producing actions; return the first non-empty result.
 * Uses Array.reduce to avoid no-await-in-loop lint.
 * @param actions - Lazy actions to try in order.
 * @returns First non-empty action result, or '' when all yield ''.
 */
async function chainFirstNonEmpty(actions: readonly (() => Promise<string>)[]): Promise<string> {
  const empty = Promise.resolve('');
  return actions.reduce<Promise<string>>(async (prev, action): Promise<string> => {
    const found = await prev;
    if (found) return found;
    return action();
  }, empty);
}

/**
 * Extract metadata from a DOM element for classification.
 * @param ctx - Playwright Page or Frame.
 * @param selector - CSS or XPath selector.
 * @returns Element metadata or false if not found.
 */
async function extractElementMeta(
  ctx: Page | Frame,
  selector: string,
): Promise<IElementMeta | false> {
  const loc = ctx.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  const tag = await loc.evaluate((el: Element): string => el.tagName.toLowerCase());
  const type = await extractAttrOrEmpty(loc, 'type');
  const role = await extractAttrOrEmpty(loc, 'role');
  const tabindex = await extractAttrOrEmpty(loc, 'tabindex');
  return { tag, type, role, tabindex };
}

/**
 * Check whether a resolved element is a fillable input (text, password, etc.).
 * @param ctx - The Playwright Page or Frame containing the element.
 * @param selector - CSS or XPath selector for the element to check.
 * @returns True if the element accepts text input via .fill().
 */
export async function isFillableInput(ctx: Page | Frame, selector: string): Promise<boolean> {
  const meta = await extractElementMeta(ctx, selector);
  if (!meta) return false;
  if (meta.tag === 'textarea') return true;
  if (meta.tag === 'input') return FILLABLE_INPUT_TYPES.has(meta.type);
  return false;
}

/**
 * Check whether a resolved element is a clickable interactive element.
 * @param ctx - The Playwright Page or Frame containing the element.
 * @param selector - CSS or XPath selector for the element to check.
 * @returns True if the element is clickable (button, link, tab, etc.).
 */
export async function isClickableElement(ctx: Page | Frame, selector: string): Promise<boolean> {
  const meta = await extractElementMeta(ctx, selector);
  if (!meta) return false;
  if (CLICKABLE_TAGS.has(meta.tag)) return true;
  if (meta.tag === 'input') return CLICKABLE_INPUT_TYPES.has(meta.type);
  if (CLICKABLE_ROLES.has(meta.role)) return true;
  return meta.tabindex !== '';
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
  const maskedForAttr = maskVisibleText(forAttr);
  const isExisting = (await ctx.locator(inputSelector).count()) > 0;
  if (!isExisting) return logMissAndEmpty(`labelText:for=${maskedForAttr}`);
  const isFillable = await isFillableInput(ctx, inputSelector);
  if (!isFillable) return logFillFailAndEmpty(forAttr, labelValue);
  logField(`labelText:${maskVisibleText(labelValue)}`, 'FOUND');
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
  const xpath = `${baseXpath}//input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:nested' });
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
  logField(`labelText:${maskVisibleText(labelValue)}`, 'FOUND');
  return selector;
}

/**
 * Strategy 4: labeling element followed by a sibling input.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the sibling input, or empty string if not found.
 */
export async function resolveBySibling(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/following-sibling::input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:sibling' });
}

/**
 * Strategy 5: nearest input in the same parent container.
 * @param opts - The xpath strategy options.
 * @returns The XPath selector for the proximity input, or empty string if not found.
 */
export async function resolveByProximity(opts: IXpathStrategyOpts): Promise<string> {
  const { ctx, baseXpath, queryFn } = opts;
  const xpath = `${baseXpath}/..//input[${NON_FILLABLE_FILTER}][1]`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag: 'labelText:proximity' });
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
 * Run the xpath/aria strategies in fallback order: nested → aria → sibling → proximity.
 * Extracted out of resolveLabelStrategies to honour the 10-LoC body cap.
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
 * Try label-based resolution (for-attr, then nesting/ariaRef/sibling/proximity/walk-up).
 * @param opts - The label resolution options.
 * @returns The resolved CSS/XPath selector, or empty string if no strategy matched.
 */
export async function resolveLabelStrategies(opts: ILabelStrategyOpts): Promise<string> {
  const forAttr = await opts.label.getAttribute('for');
  if (forAttr) return findInputByForAttr(opts.ctx, forAttr, opts.labelValue);
  return tryXpathStrategiesFallback(opts);
}

/** XPath filter to exclude non-fillable input types (hidden, submit, button, radio, checkbox). */
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
  const fieldTag = `textContent:${maskVisibleText(textValue)}`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag });
}

/** Options for building an ancestor probe action. */
interface IAncestorProbeOpts {
  ctx: Page | Frame;
  textValue: string;
  queryFn: QueryFn;
}

/**
 * Resolve one ancestor-tag probe — emits a FOUND log on hit.
 * Hoisted out of buildAncestorProbe so the parent body stays ≤ 10 LoC.
 * @param opts - The ancestor probe options.
 * @param tag - The HTML tag name to search for.
 * @returns The xpath selector when found, '' on miss.
 */
async function probeAncestorTag(opts: IAncestorProbeOpts, tag: string): Promise<string> {
  const xpath = `xpath=//${tag}[.//text()[contains(., "${opts.textValue}")]]`;
  const isFound = await opts.queryFn(opts.ctx, xpath);
  if (!isFound) return '';
  const masked = maskVisibleText(opts.textValue);
  logField(`textContent:${masked}`, 'FOUND');
  return xpath;
}

/**
 * Build a lazy action that probes a single ancestor tag for a text value.
 * @param opts - The ancestor probe options.
 * @param tag - The HTML tag name to search for.
 * @returns An async function that resolves to a selector or empty string.
 */
function buildAncestorProbe(opts: IAncestorProbeOpts, tag: string): () => Promise<string> {
  return (): Promise<string> => probeAncestorTag(opts, tag);
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
  const actions = INTERACTIVE_ANCESTORS.map((tag): (() => Promise<string>) =>
    buildAncestorProbe(opts, tag),
  );
  return chainFirstNonEmpty(actions);
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
export function divSpanStrictXpath(value: string): DivSpanStrictXpath {
  return `xpath=//*[${LABEL_TAGS}][text()[contains(., "${value}")]]` as DivSpanStrictXpath;
}

/** Options for resolving a labelText candidate. */
interface IResolveLabelTextOpts {
  ctx: Page | Frame;
  labelXpath: string;
  labelValue: string;
  queryFn: QueryFn;
}

/**
 * Try the direct label-locator path first. Returns '' when the locator
 * matches at least one element (forwards to resolveLabelStrategies) or
 * `false` when the labelXpath did not match anything (caller falls back
 * to the div/span path). `string | false` keeps us off the banned
 * `undefined` return surface.
 * @param opts - The label text resolution options.
 * @returns Resolved selector or `false` when no direct label was found.
 */
async function tryDirectLabel(opts: IResolveLabelTextOpts): Promise<string | false> {
  const { ctx, labelXpath, labelValue, queryFn } = opts;
  const labelLoc = ctx.locator(labelXpath).first();
  if ((await labelLoc.count()) === 0) return false;
  const labelOpts = { ctx, label: labelLoc, baseXpath: labelXpath, labelValue, queryFn };
  return resolveLabelStrategies(labelOpts);
}

/**
 * Fallback: search div/span elements with strict text match, then run
 * the same label-strategy ladder against them.
 * @param opts - The label text resolution options.
 * @returns Resolved selector or '' when no div/span matched.
 */
async function tryDivSpanFallback(opts: IResolveLabelTextOpts): Promise<string> {
  const { ctx, labelValue, queryFn } = opts;
  const strictXpath = divSpanStrictXpath(labelValue);
  const divSpanLoc = ctx.locator(strictXpath).first();
  if ((await divSpanLoc.count()) === 0) return '';
  logMsg(`labelText "${maskVisibleText(labelValue)}" found via div/span fallback`);
  return resolveLabelStrategies({
    ctx,
    label: divSpanLoc,
    baseXpath: strictXpath,
    labelValue,
    queryFn,
  });
}

/**
 * Resolve a labelText candidate: try label first, then div/span with strict text.
 * @param opts - The label text resolution options.
 * @returns The resolved input selector, or empty string if no resolution succeeded.
 */
export async function resolveLabelText(opts: IResolveLabelTextOpts): Promise<string> {
  const direct = await tryDirectLabel(opts);
  if (direct !== false) return direct;
  return tryDivSpanFallback(opts);
}
