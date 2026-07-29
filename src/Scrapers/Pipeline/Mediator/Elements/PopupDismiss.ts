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
 * @param attempt - 1-based attempt index, surfaced in the diagnostic log.
 * @returns True if a popup was found and clicked.
 */
async function tryDismissOnce(
  mediator: IElementMediator,
  logger: ScraperLogger,
  attempt = 1,
): Promise<boolean> {
  const result = await mediator.resolveAndClick(WK_CLOSE_POPUP).catch((): false => false);
  if (result === false) return false;
  if (!result.success || !result.value.found) return false;
  const masked = maskVisibleText(result.value.value);
  logger.debug({ text: masked, attempt, max: MAX_POPUP_ATTEMPTS });
  await mediator.waitForNetworkIdle(POPUP_SETTLE_MS).catch((): false => false);
  return true;
}

/** Recursion state for {@link dismissPopups} — keeps the arity at one. */
interface IDismissState {
  readonly mediator: IElementMediator;
  readonly logger: ScraperLogger;
  readonly attempt: number;
  readonly dismissed: number;
}

/**
 * Dismiss sequentially from the given attempt, stopping at the first
 * attempt that finds nothing left to close.
 *
 * <p>Recursive rather than a loop because attempts are strictly sequential
 * (each dismissal must settle the SPA before the next popup can resolve)
 * and `no-await-in-loop` is an error in this cluster.
 * @param state - Mediator, logger, 1-based attempt index and running count.
 * @returns Count of dismissed popups.
 */
async function dismissFrom(state: IDismissState): Promise<number> {
  if (state.attempt > MAX_POPUP_ATTEMPTS) return state.dismissed;
  const didDismiss = await tryDismissOnce(state.mediator, state.logger, state.attempt);
  if (!didDismiss) return state.dismissed;
  const next = { ...state, attempt: state.attempt + 1, dismissed: state.dismissed + 1 };
  return dismissFrom(next);
}

/**
 * Dismiss up to {@link MAX_POPUP_ATTEMPTS} popups sequentially.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Count of dismissed popups.
 */
async function dismissPopups(mediator: IElementMediator, logger: ScraperLogger): Promise<number> {
  return dismissFrom({ mediator, logger, attempt: 1, dismissed: 0 });
}

export { dismissPopups, MAX_POPUP_ATTEMPTS, POPUP_SETTLE_MS, tryDismissOnce };
