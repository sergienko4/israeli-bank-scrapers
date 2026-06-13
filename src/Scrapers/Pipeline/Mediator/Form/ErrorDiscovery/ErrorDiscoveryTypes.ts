/**
 * Shared types + constants for form-error discovery.
 *
 * <p>Phase 12d split: extracted from {@link ../FormErrorDiscovery.ts}.
 */

/** Sentinel for elements with no CSS class attribute. */
export const NO_CLASS = 'no-class';

/** Raw DOM item extracted from browser-side evaluation. */
export interface IRawDomItem {
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

/**
 * Structural CSS selectors for HTML form error elements.
 * Hidden before submit, become visible on validation failure.
 * W3C standards + widely-used framework conventions.
 * NOTE: Structural CSS is allowed in parsing/extraction code per CLAUDE.md architecture rules.
 */
export const ERROR_SELECTOR = [
  'mat-error',
  '[aria-invalid="true"]',
  '[role="alert"]',
  '[role="status"]',
  '.ng-invalid.ng-touched',
  '[class*="error"]',
  '[class*="invalid"]',
].join(',');

/** Empty scan result — no errors found. */
export const NO_ERRORS: IFormErrorScanResult = { hasErrors: false, errors: [], summary: '' };

/** Evaluation argument — passes the selector + sentinel into the browser context. */
export interface IEvalArg {
  readonly sel: string;
  readonly noClass: string;
}
