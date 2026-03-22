/**
 * Form error discovery — two layers for detecting login/OTP form errors.
 *
 * Layer 1 — discoverFormErrors: dynamic DOM structural scan.
 *   Finds mat-error, [aria-invalid], [role=alert], etc. — works for any text.
 *   Banks provide ZERO knowledge — the scanner reads whatever the DOM shows.
 *
 * Layer 2 — checkFrameForErrors: WellKnown text scan.
 *   Fallback for banks that don't use standard error markup.
 *   Checks PIPELINE_WELL_KNOWN_DASHBOARD.errorIndicator text candidates.
 *
 * Both are mediator handlers — called by IElementMediator.discoverErrors().
 * LoginSteps NEVER imports these directly — only through the mediator.
 */

import type { Frame, Page } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_DASHBOARD } from '../Registry/PipelineWellKnown.js';

/** Sentinel for elements with no CSS class attribute. */
const NO_CLASS = 'no-class';

// ── Types ──────────────────────────────────────────────────

/** Raw DOM item extracted from browser-side evaluation. */
interface IRawDomItem {
  readonly tag: string;
  readonly cls: string;
  readonly text: string;
  readonly isHidden: boolean;
}

/** Kind of error discovered — drives ScraperErrorTypes mapping upstream. */
export type FormErrorKind = 'formValidation' | 'networkError' | 'authError';

/** A single discovered form error. */
export interface IFormError {
  /** CSS selector that matched (tag + first class, or 'wellKnown' for Layer 2). */
  readonly selector: string;
  /** Visible text content of the error element. */
  readonly text: string;
  /** Semantic error kind — inferred from the matching selector. */
  readonly kind: FormErrorKind;
}

/** Unified result from any error scan (Layer 1 or Layer 2). */
export interface IFormErrorScanResult {
  /** True if at least one visible error element was found. */
  readonly hasErrors: boolean;
  /** All discovered errors (may be empty). */
  readonly errors: readonly IFormError[];
  /** First error text for logging/propagation — empty when hasErrors=false. */
  readonly summary: string;
}

// ── Constants ──────────────────────────────────────────────

/**
 * Structural CSS selectors for HTML form error elements.
 * Hidden before submit, become visible on validation failure.
 * W3C standards + widely-used framework conventions.
 * NOTE: Structural CSS is allowed in parsing/extraction code per CLAUDE.md architecture rules.
 */
const ERROR_SELECTOR = [
  'mat-error', // Angular Material — dedicated error component
  '[aria-invalid="true"]', // W3C — field is marked invalid
  '[role="alert"]', // W3C — critical dynamic announcement
  '[role="status"]', // W3C — status/progress announcements
  '.ng-invalid.ng-touched', // Angular reactive forms — touched + invalid
  '[class*="error"]', // common CSS class convention
  '[class*="invalid"]', // common CSS class convention
].join(',');

/** Empty scan result — no errors found. */
export const NO_ERRORS: IFormErrorScanResult = { hasErrors: false, errors: [], summary: '' };

// ── Layer 1: Dynamic DOM scan ──────────────────────────────

/** Evaluation argument — passes the selector string to the browser context. */
interface IEvalArg {
  readonly sel: string;
}

/**
 * Query DOM for error elements and extract visibility + text data.
 * Runs inside the browser via page.evaluate — returns plain serializable objects.
 * @param ctx - Page or frame to query.
 * @returns Array of raw DOM items matching the error selectors.
 */
async function queryDomErrors(ctx: Page | Frame): Promise<readonly IRawDomItem[]> {
  return ctx.evaluate(
    ({ sel }: IEvalArg): IRawDomItem[] => {
      const els = [...document.querySelectorAll(sel)];
      return els.map((el): IRawDomItem => {
        const cs = globalThis.getComputedStyle(el);
        const isHidden = cs.display === 'none' || cs.visibility === 'hidden';
        const cls = el.getAttribute('class') ?? NO_CLASS;
        const rawText = el.textContent;
        const text = (rawText || '').trim();
        const tag = el.tagName.toLowerCase();
        const item: IRawDomItem = { tag, cls, text, isHidden };
        return item;
      });
    },
    { sel: ERROR_SELECTOR },
  );
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
 * @param cls - Class attribute value (NO_CLASS if absent).
 * @returns CSS selector string.
 */
function buildSelector(tag: string, cls: string): string {
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
 * Filter raw DOM items to visible, non-empty ones.
 * @param items - Raw items from browser evaluation.
 * @returns Only visible items with actual text content.
 */
function filterVisible(items: readonly IRawDomItem[]): readonly IRawDomItem[] {
  return items.filter((item): boolean => !item.isHidden && item.text.length > 0);
}

/**
 * Layer 1: Scan a form frame/page for visible validation errors via DOM structure.
 * Generic for ALL banks — reads whatever the DOM shows after submit.
 * Handles detached frames gracefully (evaluate throws → empty result).
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

// ── Layer 2: WellKnown text scan ───────────────────────────

/**
 * Check one WellKnown error text for visibility in a frame.
 * @param frameOrPage - Page or frame where the form was submitted.
 * @param value - The error text to look for.
 * @returns IFormErrorScanResult with hasErrors=true if the text is visible.
 */
async function probeWellKnownText(
  frameOrPage: Page | Frame,
  value: string,
): Promise<IFormErrorScanResult> {
  const locator = frameOrPage.getByText(value);
  const first = locator.first();
  /**
   * Element not visible or detached.
   * @returns False.
   */
  const catchFalse = (): boolean => false;
  const isErrorVisible = await first.isVisible().catch(catchFalse);
  if (!isErrorVisible) return NO_ERRORS;
  const error: IFormError = { selector: 'wellKnown', text: value, kind: 'authError' };
  const result: IFormErrorScanResult = { hasErrors: true, errors: [error], summary: value };
  return result;
}

/**
 * Layer 2: Search frame for PIPELINE_WELL_KNOWN_DASHBOARD error indicator texts.
 * Fallback for banks that don't use standard error markup (mat-error, aria-invalid, etc.).
 * Handles detached frames gracefully (isVisible catch → not found).
 * @param frameOrPage - Page or frame where the login form was submitted.
 * @returns IFormErrorScanResult with first visible error text, or hasErrors=false.
 */
export async function checkFrameForErrors(
  frameOrPage: Page | Frame,
): Promise<IFormErrorScanResult> {
  const candidates = PIPELINE_WELL_KNOWN_DASHBOARD.errorIndicator;
  const initial: Promise<IFormErrorScanResult> = Promise.resolve(NO_ERRORS);
  type TReduce = Promise<IFormErrorScanResult>;
  return candidates.reduce<TReduce>(async (prev, candidate): TReduce => {
    const result = await prev;
    if (result.hasErrors) return result;
    return probeWellKnownText(frameOrPage, candidate.value);
  }, initial);
}
