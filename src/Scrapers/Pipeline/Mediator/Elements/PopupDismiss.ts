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
 * Inputs for a single dismissal attempt.
 *
 * <p>No per-attempt timeout: every attempt uses the mediator's default race
 * budget. A follow-up attempt briefly waited 30 s for a late overlay, which
 * held the homepage in a continuous multi-locator race on every bank that
 * shows any popup — Akamai answered a CI-runner IP with an edge block. Late
 * overlays are covered by the sanitization pulse instead, which re-runs this
 * probe after HOME.POST fails: later in wall-clock time than any widened
 * wait, at no idle cost.
 */
interface IDismissAttempt {
  readonly mediator: IElementMediator;
  readonly logger: ScraperLogger;
  /** 1-based attempt index, surfaced in the diagnostic log. */
  readonly attempt: number;
}

/** Recursion state for {@link dismissPopups} — keeps the arity at one. */
interface IDismissState extends IDismissAttempt {
  readonly dismissed: number;
}

/**
 * Click the first close control that resolves for this attempt.
 * @param input - Inputs for this attempt.
 * @returns Masked text of the dismissed control, or false when none resolved.
 */
async function clickCloseControl(input: IDismissAttempt): Promise<string | false> {
  const result = await input.mediator.resolveAndClick(WK_CLOSE_POPUP).catch((): false => false);
  if (result === false) return false;
  if (!result.success || !result.value.found) return false;
  return maskVisibleText(result.value.value);
}

/**
 * Attempt to dismiss one popup via WK_CLOSE_POPUP.
 * @param input - Inputs for this attempt.
 * @returns True if a popup was found and clicked.
 */
async function tryDismissOnce(input: IDismissAttempt): Promise<boolean> {
  const masked = await clickCloseControl(input);
  if (masked === false) return false;
  input.logger.debug({ text: masked, attempt: input.attempt, max: MAX_POPUP_ATTEMPTS });
  await input.mediator.waitForNetworkIdle(POPUP_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Advance to the next attempt.
 * @param state - Current recursion state.
 * @returns State for the following attempt.
 */
function nextAttempt(state: IDismissState): IDismissState {
  return {
    ...state,
    attempt: state.attempt + 1,
    dismissed: state.dismissed + 1,
  };
}

/**
 * Dismiss sequentially from the given attempt, stopping at the first attempt
 * that finds nothing left to close.
 *
 * <p>Recursive rather than a loop because attempts are strictly sequential
 * (each dismissal must settle the SPA before the next popup can resolve)
 * and `no-await-in-loop` is an error in this cluster.
 *
 * @param state - Mediator, logger, 1-based attempt index and running count.
 * @returns Count of dismissed popups.
 */
async function dismissFrom(state: IDismissState): Promise<number> {
  if (state.attempt > MAX_POPUP_ATTEMPTS) return state.dismissed;
  const didDismiss = await tryDismissOnce(state);
  if (!didDismiss) return state.dismissed;
  const next = nextAttempt(state);
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
