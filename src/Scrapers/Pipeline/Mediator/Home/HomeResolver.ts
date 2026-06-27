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
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import { preferDirectEntry } from './HomeDirectEntry.js';
import type { NavStrategy } from './HomeStrategyClassify.js';
import { classifyStrategy, NAV_STRATEGY } from './HomeStrategyClassify.js';

/** Discovery result from HOME.PRE — instructions for ACTION. */
interface IHomeDiscovery {
  /** Navigation strategy: single click or menu toggle + child click. */
  readonly strategy: NavStrategy;
  /** Text of the trigger element found in WK_HOME.ENTRY. */
  readonly triggerText: string;
  /** Pre-resolved trigger target (contextId + selector) for ACTION executor. */
  readonly triggerTarget: IResolvedTarget | false;
  /**
   * Populated only when the DIRECT trigger is an `<a target="_blank">`
   * element. ACTION must `navigateTo(navHrefOverride)` instead of
   * clicking, so the scraper's bound page reference stays on the
   * intended URL (clicking opens a new tab and strands the scraper
   * on the marketing page — see PR #299 root-cause).
   */
  readonly navHrefOverride?: string;
}

/** Bundled args for {@link classifyAndBuild} — keeps params ≤3. */
interface IClassifyAndBuildArgs {
  readonly mediator: IElementMediator;
  readonly visible: IRaceResult;
  readonly page: Page;
  readonly logger: ScraperLogger;
}

/**
 * Build the `.catch()` handler — logs the rejection cause then coerces
 * the rejection into `false` so the caller can branch without try/catch.
 * @param logger - Pipeline logger for reporting the swallowed error.
 * @returns A `.catch()` callback returning `false`.
 */
function buildRaceCatchHandler(logger: ScraperLogger): (error: unknown) => false {
  return (error: unknown): false => {
    logger.debug({ event: 'home.trigger.resolve.failed', error: String(error) });
    return false;
  };
}

/**
 * Race the WK_HOME.ENTRY candidates to locate a visible trigger.
 * Coerces the underlying race rejection into `false` (logging the
 * cause at debug level so the silent fallback remains observable)
 * so the caller can short-circuit with a fail Procedure rather than
 * try/catch.
 *
 * @param mediator - Element mediator providing the visibility race.
 * @param logger - Pipeline logger for reporting the swallowed error.
 * @returns Race result on success, `false` when nothing visible.
 */
async function resolveHomeTrigger(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<false | IRaceResult> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  const race = mediator.resolveVisible(candidates, HOME_RESOLVER_ENTRY_TIMEOUT_MS);
  const handler = buildRaceCatchHandler(logger);
  return race.catch(handler);
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
  const triggerTarget = raceResultToTarget(visible, page);
  const masked = maskVisibleText(visible.value);
  logger.debug({ text: masked });
  const strategy = await classifyStrategy(mediator, visible);
  logger.debug({ trigger: masked, target: strategy });
  const base = buildDiscoveryByStrategy(strategy, visible.value, triggerTarget);
  return attachPopupNavOverride({ base, mediator, result: visible });
}

/** Failure used by {@link resolveHomeStrategy} when no login link is found. */
const NO_LOGIN_LINK_FAIL = fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');

/**
 * Resolve the home login entry, then prefer a navigable DIRECT link over
 * an href-less SEQUENTIAL trigger (see {@link preferDirectEntry}). Returns
 * `false` when no visible trigger is found at all.
 * @param mediator - Element mediator providing the visibility race.
 * @param logger - Pipeline logger for the resolve + prefer-direct trace.
 * @returns The preferred race result, or `false` when none visible.
 */
async function resolveHomeEntry(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<false | IRaceResult> {
  const primary = await resolveHomeTrigger(mediator, logger);
  if (primary === false || !primary.found) return false;
  return preferDirectEntry({ mediator, primary, logger });
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
  const visible = await resolveHomeEntry(mediator, logger);
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

/** Bundled args for {@link attachPopupNavOverride} — keeps params ≤3. */
interface IAttachPopupArgs {
  readonly base: IHomeDiscovery;
  readonly mediator: IElementMediator;
  readonly result: IRaceResult;
}

/**
 * When the resolved DIRECT trigger is an `<a target="_blank">` link,
 * capture its `href` so HOME.ACTION can `navigateTo(href)` instead of
 * clicking. Clicking such a link causes Playwright to open a new
 * BrowserContext page; the scraper's bound `Page` reference would
 * stay on the original tab — see PR #299 root-cause analysis.
 *
 * Non-DIRECT strategies and links without `target="_blank"` pass
 * through unchanged (returns the input discovery untouched).
 *
 * @param args - Bundled base discovery + mediator + race result.
 * @returns Discovery, optionally augmented with `navHrefOverride`.
 */
async function attachPopupNavOverride(args: IAttachPopupArgs): Promise<IHomeDiscovery> {
  const { base, mediator, result } = args;
  if (base.strategy !== NAV_STRATEGY.DIRECT) return base;
  const targetAttr = await mediator.getAttributeValue(result, 'target');
  if (targetAttr !== '_blank') return base;
  const href = await mediator.getAttributeValue(result, 'href');
  if (!href) return base;
  return { ...base, navHrefOverride: href };
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
