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
  /**
   * When set, ACTION calls `executor.navigateTo(navHrefOverride)`
   * instead of clicking. Captured at PRE time for `<a target="_blank">`
   * triggers; prevents Playwright from opening a new BrowserContext
   * page and stranding the scraper on the marketing tab.
   */
  readonly navHrefOverride?: string;
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
 * Max trigger-click attempts for an `<a href="#">` login control whose
 * async click handler may not be bound yet under heavy CI throttling
 * (1 initial click + up to 2 re-clicks once the handler has settled).
 */
const MAX_TRIGGER_CLICK_ATTEMPTS = 3;

/**
 * Detect a bare-`#` hash fall-through: the click only appended an empty
 * fragment (real URL unchanged) — the signature of an `<a href="#"
 * onclick="">` trigger clicked before its async handler bound (see the
 * {@link HomePhase} prelude doc). Real navigations and non-empty
 * fragment routes (`#/login`) are excluded.
 * @param urlBefore - Page URL before the click.
 * @param urlAfter - Page URL after the click + settle.
 * @returns True iff the click only added a trailing bare `#`.
 */
function isHashFallthrough(urlBefore: string, urlAfter: string): boolean {
  if (urlAfter === urlBefore) return false;
  if (stripFragment(urlBefore) !== stripFragment(urlAfter)) return false;
  return urlAfter.endsWith('#');
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
 * Fire the trigger action: when {@link IDirectNavArgs.navHrefOverride}
 * is set, navigate to that URL directly; otherwise click the pre-
 * resolved target. The override path is taken for
 * `<a target="_blank">` triggers so Playwright does not open a new
 * tab (which would strand the scraper on the original page).
 *
 * @param args - Bundled executor + target + override.
 */
async function fireTriggerAction(args: IDirectNavArgs): Promise<void> {
  const override = args.navHrefOverride;
  if (override) {
    await args.executor.navigateTo(override).catch((): false => false);
  } else {
    await clickResolvedTarget(args.executor, args.target, args.isSequential);
  }
}

/**
 * Re-fire the trigger click once and re-settle. Recovers an
 * `<a href="#">` fall-through after the async handler has had time to
 * bind; the resulting URL is read by the caller via `getCurrentUrl`.
 * @param args - Bundled executor + target + sequencing flag + logger.
 * @param attempt - 1-based re-click attempt (for the debug trace).
 */
async function refireTrigger(args: IDirectNavArgs, attempt: number): Promise<void> {
  args.logger.debug({ event: 'home.trigger.fallthrough.reclick', attempt });
  await fireTriggerAction(args);
  await settleAfterClick(args.executor, args.isSequential);
}

/**
 * Re-click the trigger while the click keeps degrading to a bare-`#`
 * hash fall-through, bounded by {@link MAX_TRIGGER_CLICK_ATTEMPTS}.
 * Returns as soon as a real navigation / fragment route is observed, so
 * triggers that bind on the first click pay no extra cost. Recurses
 * (no loop) to honour the no-await-in-loop rule.
 * @param args - Bundled executor + target + sequencing flag + logger.
 * @param urlBefore - Page URL captured before the first click.
 * @param attempt - 1-based attempt counter (seed with 1).
 * @returns The settled URL (recovered when a re-click navigated).
 */
async function reclickWhileFallthrough(
  args: IDirectNavArgs,
  urlBefore: string,
  attempt: number,
): Promise<string> {
  const url = args.executor.getCurrentUrl();
  if (attempt >= MAX_TRIGGER_CLICK_ATTEMPTS || !isHashFallthrough(urlBefore, url)) return url;
  await refireTrigger(args, attempt);
  return reclickWhileFallthrough(args, urlBefore, attempt + 1);
}

/**
 * Perform the direct/sequential click + settle + URL probe path that
 * both NAV_STRATEGY.DIRECT and NAV_STRATEGY.SEQUENTIAL share. When the
 * first click degrades to a bare-`#` hash fall-through (async handler
 * not yet bound under heavy throttling) the trigger is re-clicked once
 * the page has settled — see {@link isHashFallthrough}.
 * @param args - Bundle of executor, target, sequencing flag, logger.
 * @returns True iff `page.url()` changed after the click(s).
 */
async function executeDirectNavigation(args: IDirectNavArgs): Promise<boolean> {
  const urlBefore = args.executor.getCurrentUrl();
  await fireTriggerAction(args);
  await settleAfterClick(args.executor, args.isSequential);
  const currentUrl = await reclickWhileFallthrough(args, urlBefore, 1);
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
  const navHrefOverride = discovery.navHrefOverride;
  return executeDirectNavigation({ executor, target, isSequential, logger, navHrefOverride });
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

export { didReallyNavigate, executeHomeNavigation, isHashFallthrough };
