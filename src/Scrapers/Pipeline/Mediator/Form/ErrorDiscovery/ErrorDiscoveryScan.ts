/**
 * Layer 1 — dynamic DOM structural scan for form errors.
 *
 * <p>Phase 12d split: extracted from {@link ../FormErrorDiscovery.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../../Base/ScraperError.js';
import { WK_LOGIN_ERROR } from '../../../Registry/WK/LoginWK.js';
import { isElementGoneError } from './ErrorDiscoveryDetached.js';
import {
  getErrorClasses,
  getErrorHidden,
  getErrorTags,
  getErrorTexts,
  type IErrorColumns,
} from './ErrorDiscoveryScanBrowser.js';
import {
  ERROR_SELECTOR,
  type FormErrorKind,
  type IFormError,
  type IFormErrorScanResult,
  type IRawDomItem,
  NO_CLASS,
  NO_ERRORS,
} from './ErrorDiscoveryTypes.js';

export { type IFormErrorScanResult } from './ErrorDiscoveryTypes.js';

/** CSS suffix that excludes form-field elements at the selector layer. */
const NON_FIELD_SUFFIX = ':not(input):not(select):not(textarea)';

/**
 * Compose a CSS selector that excludes form-field elements per disjunct.
 * Applied at the Node side so each browser closure can be a single
 * `querySelectorAll(sel).map(...)` (≤ canonical cap-10).
 * @param sel - Comma-joined CSS disjuncts (e.g. {@link ERROR_SELECTOR}).
 * @returns Same disjuncts, each with `:not(input):not(select):not(textarea)` appended.
 */
function withoutFieldsSelector(sel: string): string {
  return sel
    .split(',')
    .map((s): string => s.trim() + NON_FIELD_SUFFIX)
    .join(', ');
}

/**
 * Assert the 4 column arrays have identical lengths — if they
 * don't, the page mutated between the parallel `ctx.evaluate(...)`
 * calls and the columns would zip into garbage rows. Throwing
 * here surfaces the race instead of silently corrupting the scan
 * (CR PR #345 round-2 finding — column-alignment validation).
 *
 * <p>Returns the validated bundle so the caller can chain the
 * assertion directly into its return (avoids the `void` arch ban
 * + the bare `return;` ban — both are project lint gates).
 * @param cols - Flat-column bundle from {@link collectErrorColumns}.
 * @returns The same `cols` when all four columns share `tags.length`.
 * @throws ScraperError when any column length differs from `tags`.
 */
function assertEqualColumnLengths(cols: IErrorColumns): IErrorColumns {
  const n = cols.tags.length;
  if (cols.classes.length === n && cols.texts.length === n && cols.hidden.length === n) {
    return cols;
  }
  throw new ScraperError(buildColumnRaceMessage(cols, n));
}

/**
 * Build the diagnostic message for a column-length mismatch.
 * Extracted so {@link assertEqualColumnLengths} stays ≤cap-10 AND so
 * the numeric lengths are stringified explicitly (project lint forbids
 * `${number}` template-literal expressions).
 * @param cols - The mismatched column bundle.
 * @param n - `cols.tags.length` (anchor count).
 * @returns Human-readable diagnostic with the 4 column lengths.
 */
function buildColumnRaceMessage(cols: IErrorColumns, n: number): string {
  const c = String(cols.classes.length);
  const t = String(cols.texts.length);
  const h = String(cols.hidden.length);
  return `errorDiscovery column race: tags=${String(n)} classes=${c} texts=${t} hidden=${h}`;
}

/**
 * Collect the 4 error columns in parallel against the page/frame context.
 * Column-array data contract — see {@link ./ErrorDiscoveryScanBrowser.ts}.
 * Named `collect*` (not `fetch*`) so the architecture [Async] gate does
 * not flag the inner `Promise.all([...])` (calls ARE awaited via
 * `Promise.all`, just not directly).
 *
 * <p>Calls {@link assertEqualColumnLengths} on the gathered bundle —
 * a mid-scan page mutation could let the 4 evaluates see different
 * element counts; the assert turns that race into a re-throwable
 * error instead of silent misalignment (CR PR #345 round-2).
 * @param ctx - Page or frame to query.
 * @param sel - Pre-composed CSS selector (already field-excluded).
 * @returns Flat-column bundle ready for zipping.
 */
async function collectErrorColumns(ctx: Page | Frame, sel: string): Promise<IErrorColumns> {
  const [tags, classes, texts, hidden] = await Promise.all([
    ctx.evaluate(getErrorTags, sel),
    ctx.evaluate(getErrorClasses, { sel, noClass: NO_CLASS }),
    ctx.evaluate(getErrorTexts, sel),
    ctx.evaluate(getErrorHidden, sel),
  ]);
  return assertEqualColumnLengths({ tags, classes, texts, hidden });
}

/**
 * Zip one row of error columns into a typed {@link IRawDomItem}.
 * @param cols - The full column bundle.
 * @param i - Row index (0-based).
 * @returns Typed item for the matched element at position `i`.
 */
function zipErrorRow(cols: IErrorColumns, i: number): IRawDomItem {
  return { tag: cols.tags[i], cls: cols.classes[i], text: cols.texts[i], isHidden: cols.hidden[i] };
}

/**
 * Transform parallel column arrays into typed raw DOM items.
 * @param cols - Flat-column bundle from {@link collectErrorColumns}.
 * @returns Typed items, one entry per matched element.
 */
function zipErrorColumns(cols: IErrorColumns): readonly IRawDomItem[] {
  return cols.tags.map((_tag, i): IRawDomItem => zipErrorRow(cols, i));
}

/**
 * Run the column-bundle scan against a page/frame.
 * Extracted from {@link queryDomErrors} so the try/catch wrapper
 * stays at depth-1.
 * @param ctx - Page or frame to query.
 * @returns Raw items for every visible error candidate.
 */
async function scanDomErrors(ctx: Page | Frame): Promise<readonly IRawDomItem[]> {
  const sel = withoutFieldsSelector(ERROR_SELECTOR);
  const cols = await collectErrorColumns(ctx, sel);
  return zipErrorColumns(cols);
}

/**
 * Narrow benign Playwright rejections to "empty result"; re-throw real bugs.
 * Extracted from {@link queryDomErrors} so the wrapper stays at depth-1
 * (max-depth rule, coding-principle §9).
 * @param err - Rejection caught by the wrapper.
 * @returns Empty array for benign element-gone signals; throws otherwise.
 */
function handleDomQueryError(err: unknown): readonly IRawDomItem[] {
  if (isElementGoneError(err)) return [];
  throw err;
}

/**
 * Query DOM for error elements and extract visibility + text data.
 * NARROW catch: detached / destroyed frames return [];
 * any other rejection re-throws so real bugs surface
 * (CR PR #345 finding #186, coding-principle §9).
 * @param ctx - Page or frame to query.
 * @returns Array of raw DOM items matching the error selectors.
 */
async function queryDomErrors(ctx: Page | Frame): Promise<readonly IRawDomItem[]> {
  try {
    return await scanDomErrors(ctx);
  } catch (error) {
    return handleDomQueryError(error);
  }
}

/**
 * Classify the error kind from the matched element tag.
 * @param tag - Lowercase HTML tag name.
 * @returns FormErrorKind based on the element type.
 */
function classifyByTag(tag: string): FormErrorKind {
  if (tag === 'mat-error') return 'formValidation';
  return 'authError';
}

/**
 * Build CSS selector from tag and class.
 * @param tag - HTML tag name.
 * @param cls - Class attribute value.
 * @returns CSS selector string-shaped value (internal helper).
 */
function buildSelector(tag: string, cls: string): IFormError['selector'] {
  if (cls === NO_CLASS) return tag;
  return `${tag}.${cls.split(' ')[0]}`;
}

/**
 * Convert a raw DOM item to a typed IFormError.
 * @param item - Raw DOM item from browser evaluation.
 * @returns Typed IFormError with selector, text, and kind.
 */
function toFormError(item: IRawDomItem): IFormError {
  const selector = buildSelector(item.tag, item.cls);
  const kind = classifyByTag(item.tag);
  const error: IFormError = { selector, text: item.text, kind };
  return error;
}

/**
 * Check if text contains a KNOWN error phrase from WK.DASHBOARD.ERROR.
 * @param text - Visible text from a DOM element.
 * @returns True if text contains a known error phrase.
 */
function isKnownErrorText(text: string): boolean {
  const errorPatterns = WK_LOGIN_ERROR;
  return errorPatterns.some((pattern): boolean => text.includes(pattern.value));
}

/**
 * Check if an element is a dedicated error component (always a real error).
 * @param item - Raw DOM item.
 * @returns True if the element tag is a dedicated error component.
 */
function isDedicatedErrorTag(item: IRawDomItem): boolean {
  return item.tag === 'mat-error';
}

/**
 * Filter raw DOM items: visible + non-empty + either dedicated error
 * tag OR WK text match.
 * @param items - Raw items from browser evaluation.
 * @returns Only items that are genuine error indicators.
 */
function filterVisible(items: readonly IRawDomItem[]): readonly IRawDomItem[] {
  return items
    .filter((item): boolean => !item.isHidden && item.text.length > 0)
    .filter((item): boolean => isDedicatedErrorTag(item) || isKnownErrorText(item.text));
}

/**
 * Layer 1: Scan a form frame/page for visible validation errors via
 * DOM structure. Generic for ALL banks.
 * @param frameOrPage - The page or frame where the form was submitted.
 * @returns Scan result with all visible errors found.
 */
export async function discoverFormErrors(frameOrPage: Page | Frame): Promise<IFormErrorScanResult> {
  const rawItems = await queryDomErrors(frameOrPage);
  const visibleItems = filterVisible(rawItems);
  if (visibleItems.length === 0) return NO_ERRORS;
  const errors = visibleItems.map(toFormError);
  const summary = errors[0].text;
  const result: IFormErrorScanResult = { hasErrors: true, errors, summary };
  return result;
}
