/**
 * PopupInterceptor — dismiss popup overlays between phases.
 * Strict DOM Sanitization: up to 2 attempts before HOME and DASHBOARD.
 *
 * Factory pattern: createPopupInterceptor() returns a fresh instance per pipeline run.
 * No shared mutable state between concurrent or sequential scraper runs.
 *
 * Best-effort: never fails the pipeline. Popup absence is valid.
 */

import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import { WK_CLOSE_POPUP } from '../Registry/WK/SharedWK.js';
import type { Brand } from '../Types/Brand.js';
import type { ScraperLogger } from '../Types/Debug.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import { maskVisibleText } from '../Types/LogEvent.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

type EndpointDelta = Brand<number, 'EndpointDelta'>;
type IsInCooldown = Brand<boolean, 'IsInCooldown'>;

/** Max popup dismissal attempts per phase transition. */
const MAX_POPUP_ATTEMPTS = 2;
/** Cooldown between popup probes (ms). */
const POPUP_COOLDOWN_MS = 2000;
/** Wait for SPA state update after popup dismissal (ms). */
const POPUP_SETTLE_MS = 1000;

/**
 * Log network endpoint delta after popup dismissal.
 * @param mediator - Element mediator.
 * @param epsBefore - Endpoint count before dismiss.
 * @param logger - Pipeline logger.
 * @returns Delta count.
 */
function traceNetworkDelta(
  mediator: IElementMediator,
  epsBefore: number,
  logger: ScraperLogger,
): EndpointDelta {
  const epsAfter = mediator.network.getAllEndpoints().length;
  const delta = epsAfter - epsBefore;
  if (delta > 0) {
    logger.trace({ delta });
  }
  return delta as EndpointDelta;
}

/**
 * Only run before these phases — the 3 transitions where the bank
 * may render a modal that blocks the next discovery / extraction.
 *
 * <p>`account-resolve` added 2026-05-07 (Phase 7d): VisaCal
 * fires the new-card promo popup on the post-login render, exactly
 * the wait window where ACCOUNT-RESOLVE.PRE blocks for the first
 * id-bearing capture. Without dismissal the popup overlay can hold
 * the SPA from firing the `account/init` request and ACCOUNT-RESOLVE
 * times out empty.
 */
const POPUP_PHASES: ReadonlySet<string> = new Set(['home', 'account-resolve', 'dashboard']);

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

/**
 * Check whether cooldown has elapsed.
 * @param lastRunMs - Last probe epoch-ms.
 * @returns True if still in cooldown.
 */
function isInCooldown(lastRunMs: number): IsInCooldown {
  return (Date.now() - lastRunMs < POPUP_COOLDOWN_MS) as IsInCooldown;
}

/**
 * Dismiss popups if cooldown elapsed and phase is in whitelist.
 * @param ctx - Current pipeline context.
 * @param lastRunMs - Last probe timestamp wrapper (mutated).
 * @param lastRunMs.value - Epoch-ms of last probe.
 * @param nextPhase - Name of the phase about to run.
 * @returns Succeed always — popup absence is valid.
 */
async function tryDismiss(
  ctx: IPipelineContext,
  lastRunMs: { value: number },
  nextPhase: string,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.mediator.has || !POPUP_PHASES.has(nextPhase)) return succeed(ctx);
  if (isInCooldown(lastRunMs.value)) return succeed(ctx);
  lastRunMs.value = Date.now();
  const mediator = ctx.mediator.value;
  const eps = mediator.network.getAllEndpoints().length;
  await dismissPopups(mediator, ctx.logger);
  traceNetworkDelta(mediator, eps, ctx.logger);
  return succeed(ctx);
}

/**
 * Create a PopupInterceptor with per-instance cooldown state.
 * @returns IPipelineInterceptor that dismisses popups between phases.
 */
function createPopupInterceptor(): IPipelineInterceptor {
  const lastRunMs = { value: 0 };
  /**
   * Dismiss popups before HOME and DASHBOARD phases.
   * @param ctx - Pipeline context.
   * @param nextPhase - Phase about to run.
   * @returns Succeed with context.
   */
  const handler = async (
    ctx: IPipelineContext,
    nextPhase: string,
  ): Promise<Procedure<IPipelineContext>> => tryDismiss(ctx, lastRunMs, nextPhase);
  return { name: 'popup-dismiss', beforePhase: handler };
}

export default createPopupInterceptor;
export { createPopupInterceptor };
