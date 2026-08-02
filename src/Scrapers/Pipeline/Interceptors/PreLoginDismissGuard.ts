/**
 * PRE-LOGIN dismissal guard — decides when an obstruction probe would
 * actually be clicking the login UI.
 *
 * <p>PRE-LOGIN runs on the bank's own login page, so a "close" control there
 * is far more likely to belong to the login widget than to an obstruction.
 * Two independent proxies for "this control belongs to the login UI", each
 * necessary because neither covers every bank:
 *
 * <ol>
 *   <li>{@link WIDGET_FRAME} — the close control resolves inside a CHILD
 *       IFRAME. Covers banks embedding their login in a cross-origin widget
 *       (CAL: `connect.cal-online.co.il/send-otp`, whose `button.x-close`
 *       closes the login form itself).</li>
 *   <li>{@link LOGIN_FORM_VISIBLE} — a login form is already on screen, so
 *       nothing is obstructing the reveal and any click can only do harm.
 *       Covers banks rendering their login in the MAIN frame (Amex, Isracard,
 *       Hapoalim), where proxy 1 is inert — the gap that regressed Amex to
 *       `PRE-LOGIN: no password field` between 8.6.0 and 8.6.1.</li>
 * </ol>
 *
 * <p>Max's marketing bottom-sheet trips neither: it is a host-page overlay and
 * its login form is still hidden behind the backdrop, so dismissal proceeds.
 * Signals measured against the committed pre-login fixtures:
 *
 * <pre>
 *   bank      close  loginFormVisible   veto
 *   amex      yes    yes                LOGIN_FORM_VISIBLE
 *   isracard  yes    yes                LOGIN_FORM_VISIBLE
 *   hapoalim  yes    yes                LOGIN_FORM_VISIBLE
 *   visaCal   yes    no (child iframe)  WIDGET_FRAME
 *   max       yes    no                 none -> dismiss
 * </pre>
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import type { IElementMediator, IRaceResult } from '../Mediator/Elements/ElementMediator.js';
import { computeContextId, MAIN_CONTEXT_ID } from '../Mediator/Elements/FrameRegistry.js';
import { WK_HOME } from '../Registry/WK/HomeWK.js';
import { WK_PRELOGIN } from '../Registry/WK/PreLoginWK.js';
import { WK_CLOSE_POPUP } from '../Registry/WK/SharedWK.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';

/** Phases where a login-UI-owned close control vetoes dismissal. */
const GUARDED_PHASES: ReadonlySet<string> = new Set(['pre-login']);

/** Budget for each guard probe (ms) — a gate, not a wait. */
const GUARD_TIMEOUT_MS = 2000;

/** Why dismissal was vetoed, or `false` when it may proceed. */
type LoginUiVeto = 'widget-frame' | 'login-form-visible' | false;

/** Candidate lists widened to the resolver's shape (cast once). */
const CLOSE_CANDIDATES = WK_CLOSE_POPUP as unknown as readonly SelectorCandidate[];
const FORM_CHECK = WK_HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
const FORM_GATE = WK_PRELOGIN.FORM_GATE as unknown as readonly SelectorCandidate[];

/**
 * Race one candidate list, swallowing rejections so callers stay flat.
 * @param mediator - Element mediator.
 * @param candidates - WK candidate list to race.
 * @returns Race result, or false when nothing matched.
 */
async function probe(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<IRaceResult | false> {
  return mediator.resolveVisible(candidates, GUARD_TIMEOUT_MS).catch((): false => false);
}

/**
 * Whether a race result landed outside the main frame.
 * @param found - Race result, or false when the probe rejected.
 * @param page - Main page, for main-context identity.
 * @returns True when the winner lives in a child iframe.
 */
function isSubFrameWinner(found: IRaceResult | false, page: Page): boolean {
  if (found === false || !found.found || !found.context) return false;
  return computeContextId(found.context, page) !== MAIN_CONTEXT_ID;
}

/**
 * Whether any login form is already on screen.
 * @param mediator - Element mediator.
 * @returns True when a login field or password input is visible.
 */
async function isLoginFormVisible(mediator: IElementMediator): Promise<boolean> {
  const gate = await probe(mediator, FORM_GATE);
  if (gate !== false && gate.found) return true;
  const form = await probe(mediator, FORM_CHECK);
  return form !== false && form.found;
}

/**
 * Decide whether the visible close control belongs to the login UI.
 * @param ctx - Pipeline context (mediator + browser page).
 * @param nextPhase - Phase about to run.
 * @returns Veto reason, or false when dismissal may proceed.
 */
async function resolveLoginUiVeto(ctx: IPipelineContext, nextPhase: string): Promise<LoginUiVeto> {
  if (!GUARDED_PHASES.has(nextPhase)) return false;
  if (!ctx.mediator.has || !ctx.browser.has) return false;
  const mediator = ctx.mediator.value;
  const close = await probe(mediator, CLOSE_CANDIDATES);
  if (isSubFrameWinner(close, ctx.browser.value.page)) return 'widget-frame';
  const isFormUp = await isLoginFormVisible(mediator);
  return isFormUp ? 'login-form-visible' : false;
}

export type { LoginUiVeto };
export { GUARDED_PHASES, resolveLoginUiVeto };
