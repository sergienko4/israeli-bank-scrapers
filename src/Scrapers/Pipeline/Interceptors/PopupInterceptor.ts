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
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Max popup dismissal attempts per phase transition. */
const MAX_POPUP_ATTEMPTS = 2;
/** Cooldown between popup probes (ms). */
const POPUP_COOLDOWN_MS = 2000;
/** Wait for SPA state update after popup dismissal (ms). */
const POPUP_SETTLE_MS = 1000;

/** Epoch-ms timestamp of the last popup probe. */
type EpochMs = number;
/** Whether a popup was found and dismissed. */
type WasDismissed = boolean;

/**
 * Log network endpoint delta after popup dismissal.
 * @param mediator - Element mediator.
 * @param epsBefore - Endpoint count before dismiss.
 */
/** Network delta count after popup dismiss. */
type NetworkDelta = number;

/**
 * Log network endpoint delta after popup dismissal.
 * @param mediator - Element mediator.
 * @param epsBefore - Endpoint count before dismiss.
 * @returns Delta count.
 */
function traceNetworkDelta(mediator: IElementMediator, epsBefore: number): NetworkDelta {
  const epsAfter = mediator.network.getAllEndpoints().length;
  const delta = epsAfter - epsBefore;
  if (delta > 0) {
    process.stderr.write(`    [POPUP] network delta: +${String(delta)} endpoints after dismiss\n`);
  }
  return delta;
}

/** Only run before these phases — the 2 places popups appear. */
const POPUP_PHASES: ReadonlySet<string> = new Set(['home', 'dashboard']);

/**
 * Attempt to dismiss one popup via WK_CLOSE_POPUP.
 * @param mediator - Element mediator.
 * @returns True if a popup was found and clicked.
 */
async function tryDismissOnce(mediator: IElementMediator): Promise<WasDismissed> {
  const result = await mediator.resolveAndClick(WK_CLOSE_POPUP).catch((): false => false);
  if (!result || !result.success || !result.value.found) return false;
  process.stderr.write(`    [POPUP] dismissed: "${result.value.value}"\n`);
  await mediator.waitForNetworkIdle(POPUP_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Dismiss up to MAX_POPUP_ATTEMPTS popups sequentially.
 * @param mediator - Element mediator.
 * @returns Count of dismissed popups.
 */
async function dismissPopups(mediator: IElementMediator): Promise<number> {
  const didDismissFirst = await tryDismissOnce(mediator);
  if (!didDismissFirst) return 0;
  process.stderr.write(`    [POPUP] attempt 1/${String(MAX_POPUP_ATTEMPTS)}\n`);
  const didDismissSecond = await tryDismissOnce(mediator);
  if (!didDismissSecond) return 1;
  process.stderr.write(`    [POPUP] attempt 2/${String(MAX_POPUP_ATTEMPTS)}\n`);
  return MAX_POPUP_ATTEMPTS;
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
  lastRunMs: { value: EpochMs },
  nextPhase: string,
): Promise<Procedure<IPipelineContext>> {
  const isSkip = !ctx.mediator.has || !POPUP_PHASES.has(nextPhase);
  if (isSkip) return succeed(ctx);
  if (Date.now() - lastRunMs.value < POPUP_COOLDOWN_MS) return succeed(ctx);
  lastRunMs.value = Date.now();
  const mediator = ctx.mediator.value;
  const epsBefore = mediator.network.getAllEndpoints().length;
  await dismissPopups(mediator);
  traceNetworkDelta(mediator, epsBefore);
  return succeed(ctx);
}

/**
 * Create a PopupInterceptor with per-instance cooldown state.
 * @returns IPipelineInterceptor that dismisses popups between phases.
 */
function createPopupInterceptor(): IPipelineInterceptor {
  const lastRunMs = { value: 0 as EpochMs };
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
