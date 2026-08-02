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
import { dismissPopups } from '../Mediator/Elements/PopupDismiss.js';
import type { Brand } from '../Types/Brand.js';
import type { ScraperLogger } from '../Types/Debug.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

type EndpointDelta = Brand<number, 'EndpointDelta'>;
type IsInCooldown = Brand<boolean, 'IsInCooldown'>;

/** Cooldown between popup probes (ms). */
const POPUP_COOLDOWN_MS = 2000;

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
 * Only run before these phases — the transitions where the bank may
 * render a modal that blocks the next discovery / extraction.
 *
 * <p>`account-resolve` added 2026-05-07 (Phase 7d): VisaCal
 * fires the new-card promo popup on the post-login render, exactly
 * the wait window where ACCOUNT-RESOLVE.PRE blocks for the first
 * id-bearing capture. Without dismissal the popup overlay can hold
 * the SPA from firing the `account/init` request and ACCOUNT-RESOLVE
 * times out empty.
 *
 * <p>`pre-login` was added 2026-07-29 for Max's marketing bottom-sheet
 * and REVERTED 2026-08-02: PRE-LOGIN runs on the bank's login page, so
 * every candidate the probe can click is a control the login UI owns.
 * The iframe-provenance veto shipped alongside it only covered banks
 * whose login lives in a child iframe (CAL); Amex renders its login in
 * the MAIN frame, so the veto was inert and Amex regressed to
 * `PRE-LOGIN: no password field` between 8.6.0 and 8.6.1. Max's
 * obstruction needs a guard keyed on "does this control belong to the
 * login UI", not on which frame it lives in — see `tasks/`.
 */
const POPUP_PHASES: ReadonlySet<string> = new Set(['home', 'account-resolve', 'dashboard']);

/**
 * Check whether cooldown has elapsed.
 * @param lastRunMs - Last probe epoch-ms.
 * @returns True if still in cooldown.
 */
function isInCooldown(lastRunMs: number): IsInCooldown {
  return (Date.now() - lastRunMs < POPUP_COOLDOWN_MS) as IsInCooldown;
}

/** Bundled probe args — keeps `tryDismiss` under the per-fn line cap. */
interface IProbeArgs {
  readonly mediator: IElementMediator;
  readonly logger: ScraperLogger;
  readonly nextPhase: string;
}

/**
 * Run the dismissal probe once and emit before/after diagnostics.
 * Phase 7f follow-up: emits `popup.probe` / `popup.probe.done` even
 * when no popup is found so binding is verifiable from pipeline.log.
 *
 * @param args - Mediator + logger + next phase name.
 * @returns True after the probe completes (always succeeds).
 */
async function runDismissProbe(args: IProbeArgs): Promise<true> {
  const { mediator, logger, nextPhase } = args;
  logger.debug({ event: 'popup.probe', phase: nextPhase });
  const eps = mediator.network.getAllEndpoints().length;
  const dismissed = await dismissPopups(mediator, logger);
  const delta = traceNetworkDelta(mediator, eps, logger);
  logger.debug({ event: 'popup.probe.done', phase: nextPhase, dismissed, networkDelta: delta });
  return true as const;
}

/**
 * Dismiss popups if cooldown elapsed and phase is in whitelist.
 *
 * @param ctx - Current pipeline context.
 * @param lastRunMs - Last probe timestamp wrapper (mutated in place).
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
  if (isInCooldown(lastRunMs.value)) {
    ctx.logger.debug({ event: 'popup.skip', phase: nextPhase, reason: 'cooldown' });
    return succeed(ctx);
  }
  lastRunMs.value = Date.now();
  await runDismissProbe({ mediator: ctx.mediator.value, logger: ctx.logger, nextPhase });
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
