/**
 * HOME navigation-strategy classification — passive, read-only.
 *
 * Extracted from HomeResolver so the resolver can stay under the
 * Mediator/Home max-lines cap while the prefer-DIRECT entry fix
 * (HomeDirectEntry) reuses the same classification helpers.
 *
 * DIRECT: real href → page navigation.
 * MODAL: fake href + modal attribute (data-toggle) → DOM overlay.
 * SEQUENTIAL: fake href, no modal → menu toggle + child click.
 */

import { isOk } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Navigation strategy const — single source of truth. */
const NAV_STRATEGY = {
  DIRECT: 'DIRECT',
  SEQUENTIAL: 'SEQUENTIAL',
  MODAL: 'MODAL',
} as const;

/** Navigation strategy for HOME.ACTION. */
type NavStrategy = (typeof NAV_STRATEGY)[keyof typeof NAV_STRATEGY];

/** Non-navigation href patterns — modal triggers, SPA anchors. */
const FAKE_HREF_PATTERNS = new Set(['#', 'javascript:void(0)', 'javascript:;', '']);

/** HTML attributes that indicate a modal trigger element. */
const MODAL_ATTRIBUTES = ['data-toggle', 'data-bs-toggle'];

/**
 * Check if element has a real navigation href (passive).
 * @param mediator - Element mediator.
 * @param result - Resolved race result.
 * @returns True if href points to a real URL.
 */
async function detectRealHref(mediator: IElementMediator, result: IRaceResult): Promise<boolean> {
  const attrResult = await mediator.checkAttribute(result, 'href');
  if (!isOk(attrResult)) return false;
  if (!attrResult.value) return false;
  const rawHref = await mediator.getAttributeValue(result, 'href');
  const isFake = FAKE_HREF_PATTERNS.has(rawHref);
  return !isFake;
}

/**
 * Check one attribute for modal trigger presence.
 * @param mediator - Element mediator.
 * @param result - Resolved race result.
 * @param attr - Attribute name to check.
 * @returns True if attribute exists.
 */
async function hasAttribute(
  mediator: IElementMediator,
  result: IRaceResult,
  attr: string,
): Promise<boolean> {
  const check = await mediator.checkAttribute(result, attr);
  return isOk(check) && check.value;
}

/**
 * Check if element has a modal trigger attribute (passive).
 * @param mediator - Element mediator.
 * @param result - Resolved race result.
 * @returns True if data-toggle or data-bs-toggle found.
 */
async function detectModalAttribute(
  mediator: IElementMediator,
  result: IRaceResult,
): Promise<boolean> {
  const checks = MODAL_ATTRIBUTES.map(
    (attr: string): Promise<boolean> => hasAttribute(mediator, result, attr),
  );
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

/**
 * Classify navigation strategy from element metadata (passive).
 * @param mediator - Element mediator.
 * @param result - Resolved race result.
 * @returns Navigation strategy.
 */
async function classifyStrategy(
  mediator: IElementMediator,
  result: IRaceResult,
): Promise<NavStrategy> {
  const hasRealHref = await detectRealHref(mediator, result);
  if (hasRealHref) return NAV_STRATEGY.DIRECT;
  const isModal = await detectModalAttribute(mediator, result);
  if (isModal) return NAV_STRATEGY.MODAL;
  return NAV_STRATEGY.SEQUENTIAL;
}

export type { NavStrategy };
export { classifyStrategy, NAV_STRATEGY };
