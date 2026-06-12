/**
 * Form-anchor scoping primitives shared by every per-kind locator builder.
 * Centralises the "promote a Page/Frame to a form-scoped Locator" rule so
 * resolveAndClick / resolveVisibleNthAware can scope all candidate kinds
 * uniformly via Playwright Locator chaining (not per-builder string surgery).
 */

import type { Frame, Locator, Page } from 'playwright-core';

/** Timeout for parallel resolveAndClick race. */
export const CLICK_RACE_TIMEOUT = 3000;

/** Sentinel for "no form anchor" — empty selector means unscoped global search. */
export const NO_FORM_ANCHOR = '';

/**
 * Page, Frame, or Locator — all expose `.locator()` / `.getBy*()` so any
 * of the three can serve as a child-locator context. Used to apply form
 * scoping uniformly to ALL candidate kinds via Playwright Locator chaining.
 */
export type LocatorContext = Page | Frame | Locator;

/**
 * Apply form-anchor scoping to a context. When formAnchor is non-empty,
 * returns `ctx.locator(formAnchor)` so subsequent child-locator calls
 * (`.locator`, `.getByText`, `.getByLabel`, `.getByRole`, `.getByPlaceholder`)
 * are scoped to descendants of the matched form. When empty, returns ctx
 * unchanged. This is the single point where form-membership becomes a
 * deterministic DOM-tree filter — regardless of candidate kind.
 * @param ctx - Page or Frame.
 * @param formAnchor - CSS form selector, or empty for global scope.
 * @returns Scoped Locator or original ctx.
 */
export function applyFormScope(ctx: Page | Frame, formAnchor: string): LocatorContext {
  if (formAnchor.length === 0) return ctx;
  return ctx.locator(formAnchor);
}
