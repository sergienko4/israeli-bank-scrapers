/**
 * Observation cluster — read-only DOM probes the mediator exposes to
 * scrapers: attribute reads, element counts, and absolute-href
 * harvesting. These methods never mutate page state, never time-out
 * fatally, and always degrade gracefully (`.catch → 0` or `→ false`).
 *
 * Two micro-clusters share this file:
 *   - **Attr** — `getAttributeValue` / `checkAttribute` bound to
 *     a locator carried by an upstream `IRaceResult`.
 *   - **Count** — `countByText` / `countBySelector` / `collectAllHrefs`
 *     bound to a Page reference.
 */

import type { Locator, Page } from 'playwright-core';

import { succeed } from '../../../Types/Procedure.js';
import { type IElementMediator } from '../ElementMediator.js';

/**
 * Build getAttributeValue — read raw attribute from resolved locator.
 * @returns Async function returning the raw attribute string.
 */
function buildGetAttributeValue(): IElementMediator['getAttributeValue'] {
  return async (result, attrName) => {
    if (!result.found || !result.locator) return '';
    const attr = await result.locator.getAttribute(attrName).catch((): string => '');
    return attr ?? '';
  };
}

/**
 * Build checkAttribute — passive attribute detection on resolved locator.
 * @returns Async function returning Procedure with attribute presence.
 */
function buildCheckAttribute(): IElementMediator['checkAttribute'] {
  return async (result, attrName) => {
    if (!result.found || !result.locator) return succeed(false);
    const attr = await result.locator.getAttribute(attrName).catch((): string => '');
    const attrStr = attr ?? '';
    const hasAttr = attrStr.length > 0;
    return succeed(hasAttr);
  };
}

/**
 * Build countByText method bound to a page. Returns the TOTAL number of
 * elements whose visible text matches — Playwright `Locator.count()`
 * already enumerates every match in the page, so `.first()` is omitted
 * (it would narrow the locator to a single element and ceiling the
 * returned count at 1, defeating the public contract of "how many").
 * Returns 0 on any error (element not found = valid 0-count).
 * @param page - The Playwright page.
 * @returns Mediator countByText function.
 */
function buildCountByText(page: Page): IElementMediator['countByText'] {
  return (text: string): Promise<number> =>
    page
      .getByText(text)
      .count()
      .catch((): number => 0);
}

/**
 * Build countBySelector method bound to a page. Wraps
 * `page.locator(selector).count()` with a `.catch → 0` guard so phases
 * can probe element presence without ever touching Playwright directly.
 * Used by login.POST to verify the login form is gone after submit.
 * @param page - The Playwright page.
 * @returns Mediator countBySelector function.
 */
function buildCountBySelector(page: Page): IElementMediator['countBySelector'] {
  return (selector: string): Promise<number> =>
    page
      .locator(selector)
      .count()
      .catch((): number => 0);
}

/**
 * Extract all href attributes from anchor elements in one shot.
 * Uses evaluateAll to avoid await-in-loop — single DOM round-trip.
 * @param anchors - Locator for all anchor elements.
 * @returns Raw href strings from the DOM.
 */
async function extractRawHrefs(anchors: Locator): Promise<readonly string[]> {
  /**
   * Map anchor elements to their href attribute values.
   * @param els - Anchor elements from the DOM.
   * @returns Href strings.
   */
  const mapper = (els: HTMLAnchorElement[]): string[] => els.map((el): string => el.href);
  return anchors.evaluateAll(mapper).catch((): string[] => []);
}

/**
 * Build collectAllHrefs — harvest all absolute hrefs from anchor elements.
 * Read-only extraction via structural CSS (allowed per CLAUDE.md exceptions).
 * @param page - The Playwright page.
 * @returns Async function returning deduplicated absolute hrefs.
 */
function buildCollectAllHrefs(page: Page): () => Promise<readonly string[]> {
  return async (): Promise<readonly string[]> => {
    const anchors = page.locator('a[href]');
    const rawHrefs = await extractRawHrefs(anchors);
    return [...new Set(rawHrefs)].filter((h): boolean => h.length > 0);
  };
}

/** Attribute read surfaces — page-independent locator wrappers. */
export type AttrBundle = Pick<IElementMediator, 'checkAttribute' | 'getAttributeValue'>;

/** Counting + href-collection surfaces. */
export type CountBundle = Pick<
  IElementMediator,
  'countByText' | 'countBySelector' | 'collectAllHrefs'
>;

/**
 * Build the 2-method attribute-read cluster. Page-independent — returns
 * locator-bound wrappers (the locator carries its own Page reference).
 * @returns Attribute-read method bundle.
 */
export function buildAttrCluster(): AttrBundle {
  return {
    checkAttribute: buildCheckAttribute(),
    getAttributeValue: buildGetAttributeValue(),
  };
}

/**
 * Build the 3-method counting + href-collection cluster.
 * @param page - The Playwright page to count/collect against.
 * @returns Count / href method bundle.
 */
export function buildCountCluster(page: Page): CountBundle {
  return {
    countByText: buildCountByText(page),
    countBySelector: buildCountBySelector(page),
    collectAllHrefs: buildCollectAllHrefs(page),
  };
}
