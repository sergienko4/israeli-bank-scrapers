/**
 * HomeActions.Modal — modal click + legacy compat helpers extracted
 * from the Phase 5 HomeActions sibling so the barrel stays under the
 * per-file LoC cap (phase-2e-residue).
 */

import type { Locator, Page } from 'playwright-core';

import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { Procedure } from '../../Types/Procedure.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import { HOME_ENTRY_TIMEOUT_MS, HOME_MODAL_SETTLE_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import type { IHomeDiscovery } from './HomeResolver.js';

/**
 * Click the resolved modal trigger and wait for the iframe content to settle.
 * Pulled out so {@link executeModalClick} stays under the per-function LoC budget.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved modal trigger target.
 * @param logger - Pipeline logger.
 */
async function clickModalTrigger(
  executor: IActionMediator,
  target: IHomeDiscovery['triggerTarget'] & object,
  logger: ScraperLogger,
): Promise<void> {
  const { contextId, selector } = target;
  await executor.clickElement({ contextId, selector }).catch((): false => false);
  logger.debug({ message: 'modal: trigger clicked, waiting for content' });
  await executor.waitForNetworkIdle(HOME_MODAL_SETTLE_TIMEOUT_MS).catch((): false => false);
}

/**
 * Execute MODAL click — click trigger, wait for iframe content.
 * @param executor - Sealed action mediator.
 * @param discovery - Home discovery with MODAL strategy.
 * @param logger - Pipeline logger.
 * @returns True when the trigger click was attempted and settled.
 */
async function executeModalClick(
  executor: IActionMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!discovery.triggerTarget) return false;
  await clickModalTrigger(executor, discovery.triggerTarget, logger);
  return true;
}

/**
 * Legacy: click login link via WK_HOME.ENTRY.
 * @param mediator - Element mediator.
 * @returns Procedure with IRaceResult.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.ENTRY);
}

/**
 * Legacy: wait for any WK login link to become visible.
 * @param browserPage - Browser page.
 * @returns True if any login link visible.
 */
async function waitForAnyLoginLink(browserPage: Page): Promise<boolean> {
  const candidates = WK_HOME.ENTRY;
  const locators = candidates.map((c): Locator => browserPage.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: HOME_ENTRY_TIMEOUT_MS });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): boolean => r.status === 'fulfilled');
}

export { executeModalClick, tryClickLoginLink, waitForAnyLoginLink };
