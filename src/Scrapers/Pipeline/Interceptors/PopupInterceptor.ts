/**
 * PopupInterceptor — dismiss popup overlays between phases.
 * Runs ONCE before each phase with a 5s cooldown to avoid redundant probing.
 *
 * Factory pattern: createPopupInterceptor() returns a fresh instance per pipeline run.
 * No shared mutable state between concurrent or sequential scraper runs.
 *
 * Best-effort: never fails the pipeline. Popup absence is valid.
 */

import { WK } from '../Registry/PipelineWellKnown.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Cooldown between popup probes — no point re-checking 0.5s after last check. */
const POPUP_COOLDOWN_MS = 5000;

/** Epoch-ms timestamp of the last popup probe. */
type EpochMs = number;

/**
 * Create a PopupInterceptor with per-instance cooldown state.
 * Each pipeline run gets a fresh interceptor — no "ghost state" leaks.
 * @returns IPipelineInterceptor that dismisses popups between phases.
 */
function createPopupInterceptor(): IPipelineInterceptor {
  let lastRunMs: EpochMs = 0;
  const interceptor: IPipelineInterceptor = {
    name: 'popup-dismiss',
    /**
     * Dismiss popups if cooldown has elapsed.
     * @param ctx - Current pipeline context.
     * @returns Succeed always — popup absence is valid.
     */
    async beforePhase(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
      if (!ctx.mediator.has) return succeed(ctx);
      const now = Date.now();
      const elapsed = now - lastRunMs;
      if (elapsed < POPUP_COOLDOWN_MS) return succeed(ctx);
      lastRunMs = now;
      const mediator = ctx.mediator.value;
      await mediator.resolveAndClick(WK.CLOSE_POPUP).catch((): false => false);
      return succeed(ctx);
    },
  };
  return interceptor;
}

export default createPopupInterceptor;
export { createPopupInterceptor };
