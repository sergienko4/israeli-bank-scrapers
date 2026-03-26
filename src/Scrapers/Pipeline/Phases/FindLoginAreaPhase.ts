/**
 * FindLoginArea phase — discover and activate the credential form on the login page.
 *
 * Sits between HOME (navigated to login URL) and LOGIN (fills credentials).
 * Makes the architecture "overlay-proof": discovers the form area BEFORE any fill.
 *
 * PRE:    tryClosePopup → discover credential area / login iframe
 * ACTION: click credential area toggle (mode switch, Business/Private split)
 *         open login iframe if found (e.g. VisaCal Connect)
 * POST:   waitForFirstField → waitForCredentialsForm → checkReadiness hook
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import { some } from '../Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import {
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  tryClosePopup,
  waitForFirstField,
} from './GenericPreLoginSteps.js';
import { waitForCredentialsForm } from './HomePhase.js';

/** Navigation timeout for private-customers split pages. */
const REVEAL_NAV_TIMEOUT = 15_000;

// ── PRE: clear + discover ─────────────────────────────────

/**
 * Execute PRE step: clear overlays, discover credential area and iframe context.
 * Only tryClosePopup is an action here — everything else is discovery (resolveVisible).
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Same context (discovery is a side-effect in the Mediator race).
 */
async function executeFindLoginAreaPre(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has)
    return fail(ScraperErrorTypes.Generic, 'No browser for FIND_LOGIN_AREA PRE');
  if (!input.mediator.has)
    return fail(ScraperErrorTypes.Generic, 'No mediator for FIND_LOGIN_AREA PRE');
  const mediator = input.mediator.value;
  await tryClosePopup(mediator); // only allowed action in PRE
  return succeed(input);
}

// ── ACTION: activate the credential form ──────────────────

/**
 * Execute ACTION step: click mode toggle / open login iframe.
 * Acts on what PRE discovered. Best-effort — skip if nothing found.
 * @param ctx - Pipeline context with login config (preAction hook).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context (activeFrame set if iframe opened).
 */
async function executeFindLoginAreaAction(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has)
    return fail(ScraperErrorTypes.Generic, 'No browser for FIND_LOGIN_AREA ACTION');
  if (!input.mediator.has)
    return fail(ScraperErrorTypes.Generic, 'No mediator for FIND_LOGIN_AREA ACTION');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  await tryClickPrivateCustomers(mediator, page, REVEAL_NAV_TIMEOUT);
  await tryClickCredentialArea(mediator);
  const config = ctx.config as unknown as ILoginConfig;
  if (config.preAction) {
    await config.preAction(page).catch((): false => false);
  }
  return succeed(input);
}

// ── POST: validate form is ready ──────────────────────────

/**
 * Execute POST step: confirm credential form is visible + interactive.
 * Gate: if POST fails the LOGIN phase never starts.
 * @param ctx - Pipeline context with login config (checkReadiness hook).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context, or failure if form is not ready.
 */
async function executeFindLoginAreaPost(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has)
    return fail(ScraperErrorTypes.Generic, 'No browser for FIND_LOGIN_AREA POST');
  if (!input.mediator.has)
    return fail(ScraperErrorTypes.Generic, 'No mediator for FIND_LOGIN_AREA POST');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  const fieldWait = waitForFirstField(page);
  await fieldWait.catch((): false => false);
  await waitForCredentialsForm(mediator);
  const config = ctx.config as unknown as ILoginConfig;
  if (config.checkReadiness) {
    await config.checkReadiness(page).catch((): false => false);
  }
  // Phase-Gate Handshake: emit loginAreaReady=true — LOGIN phase gates on this signal.
  return succeed({ ...input, loginAreaReady: true });
}

// ── Step definitions + phase factory ─────────────────────

const FIND_LOGIN_AREA_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'find-login-area-pre',
  execute: executeFindLoginAreaPre,
};

const FIND_LOGIN_AREA_ACTION_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'find-login-area-action',
  execute: executeFindLoginAreaAction,
};

const FIND_LOGIN_AREA_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'find-login-area-post',
  execute: executeFindLoginAreaPost,
};

/**
 * Create the FindLoginArea phase.
 * PRE: clear + discover · ACTION: activate form · POST: validate readiness.
 * @returns IPhaseDefinition with pre, action, post.
 */
function createFindLoginAreaPhase(): IPhaseDefinition<IPipelineContext, IPipelineContext> {
  return {
    name: 'find-login-area',
    pre: some(FIND_LOGIN_AREA_PRE_STEP),
    action: FIND_LOGIN_AREA_ACTION_STEP,
    post: some(FIND_LOGIN_AREA_POST_STEP),
  };
}

export {
  createFindLoginAreaPhase,
  FIND_LOGIN_AREA_ACTION_STEP,
  FIND_LOGIN_AREA_POST_STEP,
  FIND_LOGIN_AREA_PRE_STEP,
};
