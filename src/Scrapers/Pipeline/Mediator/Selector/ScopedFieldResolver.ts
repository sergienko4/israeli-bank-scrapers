/**
 * Scoped field resolver — resolves fields within a specific form container.
 * Used when FLA.FINAL identifies an active container (e.g. Amex dual-form).
 * Bypasses visibility checks — trusts the container boundary instead.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { candidateToCss } from './SelectorResolver.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

/** CSS/XPath selector string. */
type SelectorStr = string;
/** Whether a predicate matched. */
type IsMatch = boolean;
/** DOM element count from Playwright locator. */
type ElementCount = number;

/**
 * Count elements matching a selector in a context.
 * @param ctx - Page or Frame.
 * @param sel - CSS or XPath selector.
 * @returns Count, 0 on failure.
 */
function countInContext(ctx: Page | Frame, sel: SelectorStr): Promise<ElementCount> {
  const locator = ctx.locator(sel);
  return locator.count().catch((): ElementCount => 0);
}

/**
 * Probe scoped candidates using locator.count().
 * Bypasses visibility — trusts the form container boundary.
 * @param ctx - Page or Frame to search in.
 * @param candidates - Scoped candidates (converted to CSS by form anchor).
 * @returns Resolved IFieldContext or not-found result.
 */
export default async function probeScopedField(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): Promise<IFieldContext> {
  const selectors = candidates.map(candidateToCss);
  const countPromises = selectors.map((s): Promise<ElementCount> => countInContext(ctx, s));
  const counts = await Promise.all(countPromises);
  const idx = counts.findIndex((n): IsMatch => n > 0);
  if (idx < 0) return buildNotFound(ctx);
  return buildFound(ctx, selectors[idx], candidates[idx].kind);
}

/**
 * Build a not-found result for scoped resolution.
 * @param ctx - Page or Frame context.
 * @returns IFieldContext with isResolved=false.
 */
function buildNotFound(ctx: Page | Frame): IFieldContext {
  return {
    isResolved: false,
    selector: '',
    context: ctx,
    resolvedVia: 'notResolved',
    round: 'notResolved',
  };
}

/**
 * Build a found result for scoped resolution.
 * @param ctx - Page or Frame context.
 * @param selector - The matched CSS selector.
 * @param kind - The SelectorCandidate kind that matched.
 * @returns IFieldContext with isResolved=true.
 */
function buildFound(
  ctx: Page | Frame,
  selector: SelectorStr,
  kind: SelectorCandidate['kind'],
): IFieldContext {
  return {
    isResolved: true,
    selector,
    context: ctx,
    resolvedVia: 'wellKnown',
    round: 'mainPage',
    resolvedKind: kind,
  };
}
