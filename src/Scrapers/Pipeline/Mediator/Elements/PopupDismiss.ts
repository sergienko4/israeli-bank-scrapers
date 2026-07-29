/**
 * PopupDismiss — the obstruction-clearing primitive.
 *
 * <p>Resolves the well-known close control and clicks it, up to
 * {@link MAX_POPUP_ATTEMPTS} times, settling the SPA between attempts.
 * Best-effort by contract: the absence of a popup is a valid outcome and
 * never surfaces as a failure.
 *
 * <p>Lives in the Mediator layer so that both interceptors and phases can
 * clear obstructions without a phase reaching into `Interceptors/`.
 */

import { WK_CLOSE_POPUP } from '../../Registry/WK/SharedWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IElementMediator } from './ElementMediator.js';

/** Max popup dismissal attempts per probe. */
const MAX_POPUP_ATTEMPTS = 2;

/** Wait for SPA state update after popup dismissal (ms). */
const POPUP_SETTLE_MS = 1000;

/**
 * Attempt to dismiss one popup via WK_CLOSE_POPUP.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True if a popup was found and clicked.
 */
async function tryDismissOnce(mediator: IElementMediator, logger: ScraperLogger): Promise<boolean> {
  const result = await mediator.resolveAndClick(WK_CLOSE_POPUP).catch((): false => false);
  if (result === false) return false;
  if (!result.success || !result.value.found) return false;
  const masked = maskVisibleText(result.value.value);
  logger.debug({ text: masked, attempt: 0, max: MAX_POPUP_ATTEMPTS });
  await mediator.waitForNetworkIdle(POPUP_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Dismiss up to MAX_POPUP_ATTEMPTS popups sequentially.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Count of dismissed popups.
 */
async function dismissPopups(mediator: IElementMediator, logger: ScraperLogger): Promise<number> {
  const didDismissFirst = await tryDismissOnce(mediator, logger);
  if (!didDismissFirst) return 0;
  logger.debug({ text: 'attempt', attempt: 1, max: MAX_POPUP_ATTEMPTS });
  const didDismissSecond = await tryDismissOnce(mediator, logger);
  if (!didDismissSecond) return 1;
  logger.debug({ text: 'attempt', attempt: 2, max: MAX_POPUP_ATTEMPTS });
  return MAX_POPUP_ATTEMPTS;
}

export { dismissPopups, MAX_POPUP_ATTEMPTS, POPUP_SETTLE_MS, tryDismissOnce };
