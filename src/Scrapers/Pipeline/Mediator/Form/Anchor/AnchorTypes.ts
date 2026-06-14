/**
 * Shared types + constants for form-anchor discovery.
 *
 * <p>Phase 12d split: extracted from {@link ../FormAnchor.ts}.
 */

import { type Frame, type Page } from 'playwright-core';

import { type Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
export const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/** A cached form element discovered from a resolved input field. */
export interface IFormAnchor {
  /** CSS selector uniquely identifying the form element. */
  selector: string;
  /** The Playwright context (Page or Frame) containing the form. */
  context: Page | Frame;
}

/** Regex extracting the form id from a `#id` or `form#id` CSS selector. */
export const FORM_ID_RE = /^[a-z]*#([\w-]+)$/i;

/**
 * XPath filter excluding non-fillable input types — mirrors the constant
 * defined in {@link SelectorLabelStrategies.walkUp.ts}. Inlined here to
 * keep this module self-contained for form-scoped candidate rewrites.
 */
export const NON_FILLABLE_FILTER =
  'not(@type="hidden") and not(@type="submit") and not(@type="button") ' +
  'and not(@type="radio") and not(@type="checkbox")';

/** XPath expression for ancestors, excluding html and body. */
export const ANCESTOR_XPATH = 'xpath=ancestor::*[not(self::html) and not(self::body)]';

/** Minimum fillable input count to consider a non-form element as form-like. */
export const MIN_FILLABLE_INPUTS = 2;

/** Metadata for a single ancestor element — transferred from browser to Node. */
export interface IAncestorMeta {
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
export type AncestorTuple = [string, string, boolean, number, number, number, string, string];
