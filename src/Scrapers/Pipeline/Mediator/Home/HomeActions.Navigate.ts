/**
 * HomeActions.Navigate — DIRECT/SEQUENTIAL navigation helpers
 * extracted from the Phase 5 HomeActions sibling so the barrel stays
 * under the per-file LoC cap (phase-2e-residue).
 */

import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { HOME_SETTLE_TIMEOUT_MS, HOME_SPA_NAV_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import { executeModalClick } from './HomeActions.Modal.js';
import type { IHomeDiscovery } from './HomeResolver.js';
import { NAV_STRATEGY } from './HomeResolver.js';

/** Bundled args for direct/sequential HOME navigation click. */
interface IDirectNavArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly isSequential: boolean;
  readonly logger: ScraperLogger;
}

/**
 * Click a pre-resolved target via executor.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved target from PRE.
 * @param isForce - Force click for hidden toggles.
 * @returns True if click resolved cleanly, false if executor rejected.
 */
async function clickResolvedTarget(
  executor: IActionMediator,
  target: IResolvedTarget,
  isForce?: boolean,
): Promise<boolean> {
  return executor
    .clickElement({ contextId: target.contextId, selector: target.selector, isForce })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Strip the URL fragment (`#...` suffix) for navigation comparison.
 * @param url - Absolute or relative URL.
 * @returns URL without the fragment.
 */
function stripFragment(url: string): string {
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return url;
  return url.slice(0, hashIdx);
}

/**
 * Determine whether a URL change represents real navigation rather than a
 * hash-only mutation.
 * @param urlBefore - Page URL before the click.
 * @param urlAfter - Page URL after the click.
 * @returns True iff the URL path / host / query differs (fragment ignored).
 */
function didReallyNavigate(urlBefore: string, urlAfter: string): boolean {
  if (urlBefore === urlAfter) return false;
  return stripFragment(urlBefore) !== stripFragment(urlAfter);
}

/**
 * Wait for SPA route + network settle after click.
 * @param executor - Sealed action mediator.
 * @param isSequential - Whether to settle before URL wait.
 * @returns True when settled.
 */
async function settleAfterClick(
  executor: IActionMediator,
  isSequential: boolean,
): Promise<boolean> {
  if (isSequential) await preSettleIdle(executor);
  await executor.waitForURL('**/login**', HOME_SPA_NAV_TIMEOUT_MS).catch((): false => false);
  await executor.waitForNetworkIdle(HOME_SETTLE_TIMEOUT_MS).catch((): false => false);
  return true;
}

/**
 * Absorb the pre-URL network-idle wait used by sequential nav.
 * Extracted so {@link settleAfterClick} stays under the per-function LoC budget.
 * @param executor - Sealed action mediator.
 */
async function preSettleIdle(executor: IActionMediator): Promise<void> {
  await executor.waitForNetworkIdle(HOME_SETTLE_TIMEOUT_MS).catch((): false => false);
}

/**
 * Perform the direct/sequential click + settle + URL probe path that
 * both NAV_STRATEGY.DIRECT and NAV_STRATEGY.SEQUENTIAL share.
 * @param args - Bundle of executor, target, sequencing flag, logger.
 * @returns True iff `page.url()` changed after the click.
 */
async function executeDirectNavigation(args: IDirectNavArgs): Promise<boolean> {
  const urlBefore = args.executor.getCurrentUrl();
  await clickResolvedTarget(args.executor, args.target, args.isSequential);
  await settleAfterClick(args.executor, args.isSequential);
  const currentUrl = args.executor.getCurrentUrl();
  const didNavigate = didReallyNavigate(urlBefore, currentUrl);
  args.logger.debug({ url: maskVisibleText(currentUrl), didNavigate });
  return didNavigate;
}

/** Bundled args for HOME nav-strategy dispatch. */
interface IDispatchNavArgs {
  readonly executor: IActionMediator;
  readonly discovery: IHomeDiscovery;
  readonly target: IResolvedTarget;
  readonly logger: ScraperLogger;
}

/**
 * Dispatch the click path matching the requested NAV_STRATEGY.
 * Extracted so {@link executeHomeNavigation} stays under the cap.
 * @param args - Bundled executor / discovery / target / logger.
 * @returns True iff `page.url()` changed after the click.
 */
async function dispatchNavStrategy(args: IDispatchNavArgs): Promise<boolean> {
  const { executor, discovery, target, logger } = args;
  if (discovery.strategy === NAV_STRATEGY.MODAL) {
    return executeModalClick(executor, discovery, logger);
  }
  const isSequential = discovery.strategy === NAV_STRATEGY.SEQUENTIAL;
  return executeDirectNavigation({ executor, target, isSequential, logger });
}

/**
 * Execute HOME navigation via sealed executor — SRP: ACTION clicks
 * ONLY the PRE-resolved `triggerTarget` (identity selector captured
 * by the resolver).
 * @param executor - Sealed action mediator.
 * @param discovery - Discovery from PRE.
 * @param logger - Pipeline logger.
 * @returns True iff `page.url()` changed after the click.
 */
async function executeHomeNavigation(
  executor: IActionMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<boolean> {
  const target = discovery.triggerTarget;
  if (!target) return false;
  return dispatchNavStrategy({ executor, discovery, target, logger });
}

export { didReallyNavigate, executeHomeNavigation };
