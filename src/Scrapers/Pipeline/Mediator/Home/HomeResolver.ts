/**
 * HOME phase passive discovery — 100% read-only DOM scan.
 * Rule #20: No phase may mutate state unless its name is ACTION.
 *
 * Scans WK_HOME.ENTRY for a visible trigger element.
 * Detects DIRECT (has href) vs SEQUENTIAL (menu toggle, no href).
 * Returns IHomeDiscovery — the "How-To" without the "Do."
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Navigation strategy const — single source of truth. */
const NAV_STRATEGY = {
  DIRECT: 'DIRECT',
  SEQUENTIAL: 'SEQUENTIAL',
  MODAL: 'MODAL',
} as const;

/** Navigation strategy for HOME.ACTION. */
type NavStrategy = (typeof NAV_STRATEGY)[keyof typeof NAV_STRATEGY];
/** Visible text of a trigger element. */
type TriggerText = string;
/** Predicate result for filter/some callbacks. */
type IsMatch = boolean;

/** Timeout for initial entry search. */
const ENTRY_TIMEOUT = 15000;

/** Discovery result from HOME.PRE — instructions for ACTION. */
interface IHomeDiscovery {
  /** Navigation strategy: single click or menu toggle + child click. */
  readonly strategy: NavStrategy;
  /** Text of the trigger element found in WK_HOME.ENTRY. */
  readonly triggerText: TriggerText;
  /** Menu child candidates (WK_HOME.MENU) — only for SEQUENTIAL. */
  readonly menuCandidates: readonly SelectorCandidate[];
  /** Pre-resolved trigger target (contextId + selector) for ACTION executor. */
  readonly triggerTarget: IResolvedTarget | false;
}

/**
 * Passive discovery — find login entry and detect navigation strategy.
 * Zero clicks. Zero DOM mutation. Only reads attributes.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @param page - Browser page (for contextId computation).
 * @returns Procedure with IHomeDiscovery.
 */
async function resolveHomeStrategy(
  mediator: IElementMediator,
  logger: ScraperLogger,
  page: Page,
): Promise<Procedure<IHomeDiscovery>> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  const visible = await mediator
    .resolveVisible(candidates, ENTRY_TIMEOUT)
    .catch((): false => false);
  if (visible === false) {
    return fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');
  }
  if (!visible.found) {
    return fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');
  }
  const triggerText = visible.value;
  const triggerTarget = raceResultToTarget(visible, page);
  const masked = maskVisibleText(triggerText);
  logger.debug({ text: masked });
  const strategy = await classifyStrategy(mediator, visible);
  logger.debug({ trigger: masked, target: strategy });
  const discovery = buildDiscoveryByStrategy(strategy, triggerText, triggerTarget);
  return succeed(discovery);
}

/**
 * Build discovery by strategy type (OCP dispatch).
 * @param strategy - Classified navigation strategy.
 * @param text - Trigger text.
 * @param target - Pre-resolved target.
 * @returns Discovery for the given strategy.
 */
function buildDiscoveryByStrategy(
  strategy: NavStrategy,
  text: TriggerText,
  target: IResolvedTarget | false,
): IHomeDiscovery {
  const buildMap: Record<NavStrategy, IHomeDiscovery> = {
    [NAV_STRATEGY.DIRECT]: buildDirect(text, target),
    [NAV_STRATEGY.MODAL]: buildModal(text, target),
    [NAV_STRATEGY.SEQUENTIAL]: buildSequential(text, target),
  };
  return buildMap[strategy];
}

/** Non-navigation href patterns — modal triggers, SPA anchors. */
const FAKE_HREF_PATTERNS = ['#', 'javascript:void(0)', 'javascript:;', ''];

/** HTML attributes that indicate a modal trigger element. */
const MODAL_ATTRIBUTES = ['data-toggle', 'data-bs-toggle'];

/**
 * Classify navigation strategy from element metadata (passive).
 * DIRECT: real href → page navigation.
 * MODAL: fake href + modal attribute (data-toggle) → DOM overlay.
 * SEQUENTIAL: fake href, no modal → menu toggle + child click.
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
  const isFake = FAKE_HREF_PATTERNS.some((p): IsMatch => rawHref === p);
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
 * Build DIRECT discovery — single click navigates.
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for DIRECT strategy.
 */
function buildDirect(
  triggerText: TriggerText,
  triggerTarget: IResolvedTarget | false,
): IHomeDiscovery {
  return { strategy: NAV_STRATEGY.DIRECT, triggerText, menuCandidates: [], triggerTarget };
}

/**
 * Build MODAL discovery — click trigger, modal opens, no navigation.
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for MODAL strategy.
 */
function buildModal(
  triggerText: TriggerText,
  triggerTarget: IResolvedTarget | false,
): IHomeDiscovery {
  return { strategy: NAV_STRATEGY.MODAL, triggerText, menuCandidates: [], triggerTarget };
}

/**
 * Build SEQUENTIAL discovery — menu toggle + child click.
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for SEQUENTIAL strategy.
 */
function buildSequential(
  triggerText: TriggerText,
  triggerTarget: IResolvedTarget | false,
): IHomeDiscovery {
  const menu = WK_HOME.MENU as unknown as readonly SelectorCandidate[];
  return { strategy: NAV_STRATEGY.SEQUENTIAL, triggerText, menuCandidates: menu, triggerTarget };
}

export type { IHomeDiscovery };
export default resolveHomeStrategy;
export { NAV_STRATEGY, resolveHomeStrategy };
