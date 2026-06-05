/**
 * Menu-click + href-nav helpers for DASHBOARD ACTION, plus the PRE
 * clickable-text dump used for forensic logging when no nav target
 * was found.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap.
 */

import type { Page } from 'playwright-core';

import { maskVisibleText } from '../../Types/LogEvent.js';
import type {
  IApiFetchContext,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { IActionMediator, IElementMediator } from '../Elements/ElementMediator.js';
import { DASHBOARD_MENU_SETTLE_MS } from '../Timing/TimingConfig.js';
import { buildApiContext } from './DashboardDiscovery.js';

/** Should force-click for hidden menu toggles. */
const shouldForceMenuClick = true;

/**
 * Build the API override bundle from the pipeline config.
 * @param input - Pipeline context with config.
 * @returns Override bundle for {@link buildApiContext}.
 */
function buildApiOverride(input: IPipelineContext): {
  readonly baseUrl: string;
  readonly transactionsPath?: string;
} {
  return { baseUrl: input.config.urls.base, transactionsPath: input.config.transactionsPath };
}

/**
 * Build API context if fetchStrategy available.
 * @param input - Pipeline context.
 * @param network - Network discovery.
 * @returns API context or false.
 */
async function buildApiIfAvailable(
  input: IPipelineContext,
  network: IElementMediator['network'],
): Promise<IApiFetchContext | false> {
  if (!input.fetchStrategy.has) return false;
  const override = buildApiOverride(input);
  return buildApiContext(network, input.fetchStrategy.value, override).catch((): false => false);
}

/** CSS selector for "clickable text" elements scanned by the PRE dump. */
const CLICKABLE_SEL = 'a, button, [role="tab"], [role="link"], [role="button"]';

/** Upper-bound on the length of a clickable-text snippet retained for forensic logging. */
const CLICKABLE_TEXT_MAX_LEN = 60;

/**
 * Browser-side projector — deduped, length-filtered visible text of clickable elements.
 * @param els - Elements matched by {@link CLICKABLE_SEL}.
 * @param maxLen - Upper-bound on retained snippet length.
 * @returns Unique visible-text snippets within `[2, maxLen)`.
 */
function projectClickableTexts(els: Element[], maxLen: number): string[] {
  return [
    ...new Set(
      els.map(el => (el.textContent || '').trim()).filter(t => t.length > 1 && t.length < maxLen),
    ),
  ];
}

/**
 * Collect deduped, length-filtered visible text of all clickable
 * elements on the page. Used by {@link dumpDashboardText} for WK
 * forensic logging when PRE cannot find a nav target.
 * @param page - Browser page.
 * @returns Unique visible-text snippets (length 2..59).
 */
function collectClickableTexts(page: Page): Promise<string[]> {
  return page.$$eval(CLICKABLE_SEL, projectClickableTexts, CLICKABLE_TEXT_MAX_LEN);
}

/**
 * Inner branch of {@link dumpDashboardText} — keeps the try/catch terse.
 * @param page - Already-narrowed browser page.
 * @param logger - Pipeline logger.
 * @returns Always true once the log line is emitted.
 */
async function emitClickableTextLog(page: Page, logger: IPipelineContext['logger']): Promise<true> {
  const texts = await collectClickableTexts(page);
  logger.debug({ message: `VISIBLE CLICKABLE TEXT: [${texts.join(' | ')}]` });
  return true;
}

/**
 * Dump all visible clickable text on the page for WK forensic discovery
 * when DASHBOARD.PRE cannot find a nav target.
 * @param input - Pipeline context with browser.
 * @returns True when the dump emitted, false on missing browser / error.
 */
async function dumpDashboardText(input: IPipelineContext): Promise<boolean> {
  if (!input.browser.has) return false;
  try {
    return await emitClickableTextLog(input.browser.value.page, input.logger);
  } catch {
    return false;
  }
}

/**
 * Click a resolved menu target via the sealed action mediator. Best-
 * effort — failures coerce to `false` so the caller can log + skip the
 * network settle.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved menu target.
 * @returns True when the click resolved, false on caught error.
 */
async function tryClickMenu(executor: IActionMediator, target: IResolvedTarget): Promise<boolean> {
  const { contextId, selector } = target;
  return executor
    .clickElement({ contextId, selector, isForce: shouldForceMenuClick })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Settle the network after a successful menu click.
 * @param executor - Sealed action mediator.
 * @returns Always true once the settle attempt has resolved.
 */
async function settleAfterMenuClick(executor: IActionMediator): Promise<true> {
  await executor.waitForNetworkIdle(DASHBOARD_MENU_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Log the result of an attempted menu click + settle the network when it
 * succeeded. Pulled out so {@link executeMenuClick} stays under the LoC cap.
 * @param executor - Sealed action mediator.
 * @param didClick - Whether the click attempt resolved successfully.
 * @param logger - Pipeline logger.
 * @returns The unchanged `didClick` bit so the caller can return it.
 */
async function settleMenuClickOutcome(
  executor: IActionMediator,
  didClick: boolean,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  if (!didClick) logger.debug({ message: 'menu click failed' });
  if (didClick) await settleAfterMenuClick(executor);
  return didClick;
}

/**
 * Click a menu toggle via sealed executor (force-click).
 * Best-effort: catch failures, POST validates traffic.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved menu target.
 * @param logger - Pipeline logger.
 * @returns True if clicked.
 */
async function executeMenuClick(
  executor: IActionMediator,
  target: IResolvedTarget,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  const masked = maskVisibleText(target.selector);
  logger.debug({ strategy: 'MENU', result: `${target.contextId} > ${masked}` });
  const didClick = await tryClickMenu(executor, target);
  return settleMenuClickOutcome(executor, didClick, logger);
}

/**
 * Attempt the physical href navigation via the sealed action mediator.
 * @param executor - Sealed action mediator.
 * @param href - Target URL.
 * @returns True when the navigation resolved, false on caught error.
 */
async function tryNavHref(executor: IActionMediator, href: string): Promise<boolean> {
  return executor
    .navigateTo(href, { waitUntil: 'domcontentloaded' })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Log the result of an attempted href nav + settle the network when it
 * succeeded. Pulled out so {@link executeHrefNav} stays under the LoC cap.
 * @param executor - Sealed action mediator.
 * @param didNav - Whether the nav attempt resolved successfully.
 * @param logger - Pipeline logger.
 * @returns The unchanged `didNav` bit so the caller can return it.
 */
async function settleHrefNavOutcome(
  executor: IActionMediator,
  didNav: boolean,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  if (!didNav) logger.debug({ message: 'nav failed -- traffic from login' });
  if (didNav) await executor.waitForNetworkIdle().catch((): false => false);
  return didNav;
}

/**
 * Navigate to an href target via sealed executor.
 * @param executor - Sealed action mediator.
 * @param href - Target URL.
 * @param logger - Pipeline logger.
 * @returns True if navigated.
 */
async function executeHrefNav(
  executor: IActionMediator,
  href: string,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  logger.debug({ strategy: 'NAV', result: maskVisibleText(href) });
  const didNav = await tryNavHref(executor, href);
  return settleHrefNavOutcome(executor, didNav, logger);
}

export { buildApiIfAvailable, dumpDashboardText, executeHrefNav, executeMenuClick };
