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
import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Navigation strategy const — single source of truth. */
const NAV_STRATEGY = {
  DIRECT: 'DIRECT',
  SEQUENTIAL: 'SEQUENTIAL',
  MODAL: 'MODAL',
} as const;

/** Navigation strategy for HOME.ACTION. */
type NavStrategy = (typeof NAV_STRATEGY)[keyof typeof NAV_STRATEGY];

/** Discovery result from HOME.PRE — instructions for ACTION. */
interface IHomeDiscovery {
  /** Navigation strategy: single click or menu toggle + child click. */
  readonly strategy: NavStrategy;
  /** Text of the trigger element found in WK_HOME.ENTRY. */
  readonly triggerText: string;
  /** Pre-resolved trigger target (contextId + selector) for ACTION executor. */
  readonly triggerTarget: IResolvedTarget | false;
}

/** Bundled args for {@link classifyAndBuild} — keeps params ≤3. */
interface IClassifyAndBuildArgs {
  readonly mediator: IElementMediator;
  readonly visible: IRaceResult;
  readonly page: Page;
  readonly logger: ScraperLogger;
}

/**
 * Race the WK_HOME.ENTRY candidates to locate a visible trigger.
 * Swallows the underlying race rejection into `false` so the caller
 * can short-circuit with a fail Procedure rather than try/catch.
 *
 * @param mediator - Element mediator providing the visibility race.
 * @returns Race result on success, `false` when nothing visible.
 */
async function resolveHomeTrigger(mediator: IElementMediator): Promise<false | IRaceResult> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  return mediator
    .resolveVisible(candidates, HOME_RESOLVER_ENTRY_TIMEOUT_MS)
    .catch((): false => false);
}

/**
 * Classify the visible trigger's navigation strategy and assemble the
 * matching {@link IHomeDiscovery}. Logs the masked trigger text twice
 * (pre-classify and post-classify) to keep the debug trace
 * deterministic across strategies.
 *
 * @param args - Bundled mediator, visible race result, page, logger.
 * @returns Strategy-specific discovery (DIRECT/MODAL/SEQUENTIAL).
 */
async function classifyAndBuild(args: IClassifyAndBuildArgs): Promise<IHomeDiscovery> {
  const { mediator, visible, page, logger } = args;
  const triggerText = visible.value;
  const triggerTarget = raceResultToTarget(visible, page);
  const masked = maskVisibleText(triggerText);
  logger.debug({ text: masked });
  const strategy = await classifyStrategy(mediator, visible);
  logger.debug({ trigger: masked, target: strategy });
  return buildDiscoveryByStrategy(strategy, triggerText, triggerTarget);
}

/** Failure used by {@link resolveHomeStrategy} when no login link is found. */
const NO_LOGIN_LINK_FAIL = fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');

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
  const visible = await resolveHomeTrigger(mediator);
  if (visible === false || !visible.found) return NO_LOGIN_LINK_FAIL;
  const discovery = await classifyAndBuild({ mediator, visible, page, logger });
  return succeed(discovery);
}

/** Builder lookup for {@link buildDiscoveryByStrategy} — keeps it a thin dispatcher. */
const DISCOVERY_BUILDERS: Record<
  NavStrategy,
  (text: string, target: IResolvedTarget | false) => IHomeDiscovery
> = {
  [NAV_STRATEGY.DIRECT]: buildDirect,
  [NAV_STRATEGY.MODAL]: buildModal,
  [NAV_STRATEGY.SEQUENTIAL]: buildSequential,
};

/**
 * Build discovery by strategy type (OCP dispatch).
 * @param strategy - Classified navigation strategy.
 * @param text - Trigger text.
 * @param target - Pre-resolved target.
 * @returns Discovery for the given strategy.
 */
function buildDiscoveryByStrategy(
  strategy: NavStrategy,
  text: string,
  target: IResolvedTarget | false,
): IHomeDiscovery {
  return DISCOVERY_BUILDERS[strategy](text, target);
}

/** Non-navigation href patterns — modal triggers, SPA anchors. */
const FAKE_HREF_PATTERNS = new Set(['#', 'javascript:void(0)', 'javascript:;', '']);

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
 * Build DIRECT discovery — single click navigates.
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for DIRECT strategy.
 */
function buildDirect(triggerText: string, triggerTarget: IResolvedTarget | false): IHomeDiscovery {
  return { strategy: NAV_STRATEGY.DIRECT, triggerText, triggerTarget };
}

/**
 * Build MODAL discovery — click trigger, modal opens, no navigation.
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for MODAL strategy.
 */
function buildModal(triggerText: string, triggerTarget: IResolvedTarget | false): IHomeDiscovery {
  return { strategy: NAV_STRATEGY.MODAL, triggerText, triggerTarget };
}

/**
 * Build SEQUENTIAL discovery — single click on the same identity-
 * based `triggerTarget` as DIRECT. Strategy distinction kept for
 * back-compat / classification semantics, but ACTION takes the
 * same code path. The legacy `menuCandidates` text array was
 * removed in Phase 6 (Max BoG regression — see HomeActions.ts
 * `executeHomeNavigation` doc).
 * @param triggerText - Trigger element text.
 * @param triggerTarget - Pre-resolved target for ACTION executor.
 * @returns IHomeDiscovery for SEQUENTIAL strategy.
 */
function buildSequential(
  triggerText: string,
  triggerTarget: IResolvedTarget | false,
): IHomeDiscovery {
  return { strategy: NAV_STRATEGY.SEQUENTIAL, triggerText, triggerTarget };
}

export type { IHomeDiscovery };
export default resolveHomeStrategy;
export { NAV_STRATEGY, resolveHomeStrategy };
