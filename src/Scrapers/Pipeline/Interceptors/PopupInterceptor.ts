/**
 * PopupInterceptor — dismiss popup overlays between phases.
 * Strict DOM Sanitization: up to 2 attempts before HOME and DASHBOARD.
 *
 * Factory pattern: createPopupInterceptor() returns a fresh instance per pipeline run.
 * No shared mutable state between concurrent or sequential scraper runs.
 *
 * Best-effort: never fails the pipeline. Popup absence is valid.
 */

import type { Page } from 'playwright-core';

import type { IElementMediator, IRaceResult } from '../Mediator/Elements/ElementMediator.js';
import { computeContextId, MAIN_CONTEXT_ID } from '../Mediator/Elements/FrameRegistry.js';
import { dismissPopups } from '../Mediator/Elements/PopupDismiss.js';
import { WK_CLOSE_POPUP } from '../Registry/WK/SharedWK.js';
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
/** Budget for the close-control provenance probe (ms) — a gate, not a wait. */
const FRAME_GATE_TIMEOUT_MS = 2000;

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
 * <p>`pre-login` added 2026-07-29: Max renders a marketing bottom-sheet
 * behind a full-page dark backdrop AFTER the HOME probe already ran, so
 * the backdrop intercepts every PRE-LOGIN click until it is dismissed.
 * This entry is only safe together with {@link MAIN_FRAME_ONLY_PHASES}.
 */
const POPUP_PHASES: ReadonlySet<string> = new Set([
  'home',
  'pre-login',
  'account-resolve',
  'dashboard',
]);

/**
 * Phases where a close control living inside a CHILD IFRAME vetoes dismissal.
 *
 * <p>Rationale (2026-07-29): whitelisting `pre-login` without this veto
 * regressed VisaCal from PASS to FAIL. Banks that embed their login UI in
 * a cross-origin widget iframe (CAL: `connect.cal-online.co.il/send-otp`)
 * expose that widget's OWN close button (`<button class="x-close">`) as the
 * only visible close control, so the probe closed the login form itself and
 * PRE-LOGIN then reported "no password field".
 *
 * <p>The discriminator is provenance, not appearance: what PRE-LOGIN needs
 * to unblock is a HOST-PAGE overlay covering the reveal control (Max's
 * marketing sheet resolves at the page URL). A control rendered inside the
 * bank's own embedded widget is part of the login UI, never an obstruction.
 *
 * <p>Deliberately scoped to `pre-login` only — `home`, `account-resolve`
 * and `dashboard` keep their pre-existing all-frames behaviour.
 */
const MAIN_FRAME_ONLY_PHASES: ReadonlySet<string> = new Set(['pre-login']);

/** Why a probe was skipped, or `false` when it should run. */
type SkipReason = 'cooldown' | 'widget-frame' | false;

/**
 * Narrow a probe result to "the winning close control is inside a child iframe".
 * @param found - Result of the provenance probe, or false when it rejected.
 * @param page - Main page, used for main-context identity.
 * @returns True when the winner lives outside the main frame.
 */
function isSubFrameWinner(found: IRaceResult | false, page: Page): boolean {
  if (found === false || !found.found || !found.context) return false;
  return computeContextId(found.context, page) !== MAIN_CONTEXT_ID;
}

/**
 * Whether the only visible close control belongs to an embedded widget.
 * @param ctx - Pipeline context (mediator + browser page).
 * @param nextPhase - Phase about to run.
 * @returns True when dismissal must be vetoed.
 */
async function isCloseControlInSubFrame(
  ctx: IPipelineContext,
  nextPhase: string,
): Promise<boolean> {
  if (!MAIN_FRAME_ONLY_PHASES.has(nextPhase)) return false;
  if (!ctx.mediator.has || !ctx.browser.has) return false;
  const found = await ctx.mediator.value
    .resolveVisible(WK_CLOSE_POPUP, FRAME_GATE_TIMEOUT_MS)
    .catch((): false => false);
  return isSubFrameWinner(found, ctx.browser.value.page);
}

/**
 * Decide whether to skip this probe, and why.
 * @param ctx - Pipeline context.
 * @param lastRunMs - Epoch-ms of the previous probe.
 * @param nextPhase - Phase about to run.
 * @returns Skip reason, or false to run the probe.
 */
async function resolveSkipReason(
  ctx: IPipelineContext,
  lastRunMs: number,
  nextPhase: string,
): Promise<SkipReason> {
  if (isInCooldown(lastRunMs)) return 'cooldown';
  const isWidgetOwned = await isCloseControlInSubFrame(ctx, nextPhase);
  if (isWidgetOwned) return 'widget-frame';
  return false;
}

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
  const skip = await resolveSkipReason(ctx, lastRunMs.value, nextPhase);
  if (skip !== false) {
    ctx.logger.debug({ event: 'popup.skip', phase: nextPhase, reason: skip });
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
