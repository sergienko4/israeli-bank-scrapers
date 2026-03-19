/**
 * Dynamic form error scanner — discovers validation errors by DOM structure.
 * Works for any form (login, OTP, etc.) without knowing specific error text.
 *
 * How it works:
 *   HTML forms hide error elements (mat-error, role=alert, etc.) until submit.
 *   After submit, visible elements with error indicators contain the error text.
 *   We query by structural markers (aria, Angular Material, CSS class conventions),
 *   filter to visible, non-empty elements, and return what we find.
 *
 * Banks provide ZERO text — the scanner reads whatever the DOM shows.
 */

import type { Frame, Page } from 'playwright-core';

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
  /** CSS selector that matched (tag + first class). */
  readonly selector: string;
  /** Visible text content of the error element. */
  readonly text: string;
  /** Semantic error kind — inferred from the matching selector. */
  readonly kind: FormErrorKind;
}

/** Result of a form error scan. */
export interface IFormErrorScanResult {
  /** True if at least one visible error element was found. */
  readonly hasErrors: boolean;
  /** All discovered errors (may be empty). */
  readonly errors: readonly IFormError[];
  /** Concatenated summary for logging — empty when hasErrors=false. */
  readonly summary: string;
}

// ── Constants ──────────────────────────────────────────────

/**
 * Structural CSS selectors for HTML form error elements.
 * These are hidden before submit and become visible on validation failure.
 * All are W3C accessibility standards or widely-used framework conventions.
 */
const ERROR_SELECTOR = [
  'mat-error', // Angular Material — dedicated error component
  '[aria-invalid="true"]', // W3C — field is marked invalid
  '[role="alert"]', // W3C — critical dynamic announcement
  '[role="status"]', // W3C — status/progress announcements
  '.ng-invalid.ng-touched', // Angular reactive forms — touched + invalid state
  '[class*="error"]', // common CSS class convention
  '[class*="invalid"]', // common CSS class convention
].join(',');

/** Empty scan result returned when no errors are found. */
const NO_ERRORS: IFormErrorScanResult = { hasErrors: false, errors: [], summary: '' };

// ── Browser evaluation ─────────────────────────────────────

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
      return els.map(el => {
        const cs = window.getComputedStyle(el);
        const isHidden = cs.display === 'none' || cs.visibility === 'hidden';
        return {
          tag: el.tagName.toLowerCase(),
          cls: el.className || '',
          text: (el.textContent || '').trim(),
          isHidden,
        };
      });
    },
    { sel: ERROR_SELECTOR },
  );
}

// ── Classification ─────────────────────────────────────────

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
 * Convert a raw DOM item to a typed IFormError.
 * @param item - Raw DOM item from browser evaluation.
 * @returns Typed IFormError with selector, text, and kind.
 */
function toFormError(item: IRawDomItem): IFormError {
  const firstCls = item.cls ? `.${item.cls.split(' ')[0]}` : '';
  const selector = `${item.tag}${firstCls}`;
  const kind = classifyByTag(item.tag);
  return { selector, text: item.text, kind };
}

/**
 * Filter raw DOM items to visible, non-empty ones.
 * @param items - Raw items from browser evaluation.
 * @returns Only visible items with actual text content.
 */
function filterVisible(items: readonly IRawDomItem[]): readonly IRawDomItem[] {
  return items.filter(item => !item.isHidden && item.text.length > 0);
}

// ── Entry point ────────────────────────────────────────────

/**
 * Scan a form frame/page for visible validation errors.
 * Generic for ALL banks — reads whatever the DOM shows after submit.
 * Handles detached frames gracefully (evaluate throws → empty result).
 * @param frameOrPage - The page or frame where the form was submitted.
 * @returns Scan result with all visible errors found.
 */
export async function discoverFormErrors(frameOrPage: Page | Frame): Promise<IFormErrorScanResult> {
  const rawItems = await queryDomErrors(frameOrPage).catch(() => []);
  const visibleItems = filterVisible(rawItems);
  if (visibleItems.length === 0) return NO_ERRORS;
  const errors = visibleItems.map(toFormError);
  const summary = errors[0].text;
  return { hasErrors: true, errors, summary };
}
