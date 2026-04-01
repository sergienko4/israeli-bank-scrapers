/**
 * PopupInterceptor — dismiss popup overlays between phases.
 * Runs ONCE before each phase with a 5s cooldown to avoid redundant probing.
 *
 * Factory pattern: createPopupInterceptor() returns a fresh instance per pipeline run.
 * No shared mutable state between concurrent or sequential scraper runs.
 *
 * Best-effort: never fails the pipeline. Popup absence is valid.
 */

import { WK_CLOSE_POPUP } from '../Registry/WK/SharedWK.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Cooldown between popup probes — no point re-checking 0.5s after last check. */
const POPUP_COOLDOWN_MS = 5000;

/** Epoch-ms timestamp of the last popup probe. */
type EpochMs = number;

/**
 * Attempt popup dismissal if cooldown elapsed.
 * @param ctx - Current pipeline context.
 * @param lastRunMs - Last probe timestamp wrapper (mutated).
 * @param lastRunMs.value - Epoch-ms of last probe.
 * @returns Succeed always — popup absence is valid.
 */
async function tryDismiss(
  ctx: IPipelineContext,
  lastRunMs: { value: EpochMs },
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.mediator.has) return succeed(ctx);
  const elapsed = Date.now() - lastRunMs.value;
  if (elapsed < POPUP_COOLDOWN_MS) return succeed(ctx);
  lastRunMs.value = Date.now();
  await ctx.mediator.value.resolveAndClick(WK_CLOSE_POPUP).catch((): false => false);
  return succeed(ctx);
}

/**
 * Create a PopupInterceptor with per-instance cooldown state.
 * Each pipeline run gets a fresh interceptor — no "ghost state" leaks.
 * @returns IPipelineInterceptor that dismisses popups between phases.
 */
function createPopupInterceptor(): IPipelineInterceptor {
  const lastRunMs = { value: 0 as EpochMs };
  return {
    name: 'popup-dismiss',
    /**
     * Dismiss popups if cooldown elapsed.
     * @param ctx - Pipeline context.
     * @returns Succeed with context.
     */
    async beforePhase(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
      return tryDismiss(ctx, lastRunMs);
    },
  };
}

export default createPopupInterceptor;
export { createPopupInterceptor };
