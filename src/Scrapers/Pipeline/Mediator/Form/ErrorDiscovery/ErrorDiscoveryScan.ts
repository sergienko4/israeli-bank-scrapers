/**
 * Layer 1 — dynamic DOM structural scan for form errors.
 *
 * <p>Phase 12d split: extracted from {@link ../FormErrorDiscovery.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { WK_LOGIN_ERROR } from '../../../Registry/WK/LoginWK.js';
import {
  ERROR_SELECTOR,
  type FormErrorKind,
  type IEvalArg,
  type IFormError,
  type IFormErrorScanResult,
  type IRawDomItem,
  NO_CLASS,
  NO_ERRORS,
} from './ErrorDiscoveryTypes.js';

export { type IFormErrorScanResult } from './ErrorDiscoveryTypes.js';

/**
 * Browser-context callback for queryDomErrors — must be self-contained
 * (no captured closures). Playwright serializes the function source for
 * transport into the page context — any module-scope reference would be
 * undefined at runtime.
 * @param arg - Selector + sentinel bundle passed from Node side.
 * @param arg.sel - CSS selector for the error candidates.
 * @param arg.noClass - Sentinel string for elements with no `class` attribute.
 * @returns Raw DOM items for every visible error candidate.
 */
function scanDomErrorsInBrowser({ sel, noClass }: IEvalArg): IRawDomItem[] {
  const fieldTags = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
  const all = [...document.querySelectorAll(sel)];
  return all
    .filter((el): boolean => !fieldTags.has(el.tagName))
    .map((el): IRawDomItem => {
      const cs = globalThis.getComputedStyle(el);
      const isHidden = cs.display === 'none' || cs.visibility === 'hidden';
      return {
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute('class') ?? noClass,
        text: (el.textContent || '').trim(),
        isHidden,
      };
    });
}

/**
 * Query DOM for error elements and extract visibility + text data.
 * @param ctx - Page or frame to query.
 * @returns Array of raw DOM items matching the error selectors.
 */
async function queryDomErrors(ctx: Page | Frame): Promise<readonly IRawDomItem[]> {
  return ctx.evaluate(scanDomErrorsInBrowser, { sel: ERROR_SELECTOR, noClass: NO_CLASS });
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
  /**
   * Graceful fallback for detached frames.
   * @returns Empty array.
   */
  const emptyFallback = (): readonly IRawDomItem[] => [];
  const rawItems = await queryDomErrors(frameOrPage).catch(emptyFallback);
  const visibleItems = filterVisible(rawItems);
  if (visibleItems.length === 0) return NO_ERRORS;
  const errors = visibleItems.map(toFormError);
  const summary = errors[0].text;
  const result: IFormErrorScanResult = { hasErrors: true, errors, summary };
  return result;
}
