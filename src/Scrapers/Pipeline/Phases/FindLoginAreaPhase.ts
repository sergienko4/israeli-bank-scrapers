/**
 * FindLoginArea phase — discover and activate the credential form on the login page.
 *
 * Strict PRE / ACTION / POST separation:
 *
 *   PRE    (Eyes/Discovery): scans the DOM, returns RevealStatus per candidate type.
 *          Only tryClosePopup is an action here — everything else is resolveVisible only.
 *          Stores IFindLoginAreaDiscovery in context for ACTION to consume.
 *
 *   ACTION (Hands/Actuator): reads PRE discovery. Fires ONLY if PRE returned READY or OBSCURED.
 *          OBSCURED → force:true already applied by mediator's resolveAndClick fallback.
 *          NOT_FOUND → skipped entirely.
 *
 *   POST   (Gatekeeper): validates form is interactive → sets loginAreaReady=true.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { WK } from '../Registry/PipelineWellKnown.js';
import { some } from '../Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from '../Types/Phase.js';
import type {
  IFindLoginAreaDiscovery,
  IPipelineContext,
  RevealStatus,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import {
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  tryClosePopup,
  waitForFirstField,
} from './GenericPreLoginSteps.js';
import { waitForCredentialsForm } from './HomePhase.js';

/** Timeout for credential area discovery in PRE — SPAs render asynchronously; 15s avoids OBSCURED false-positive. */
const DISCOVER_TIMEOUT = 15_000;

/** Whether a DOM element count check matched (> 0). */
type ElementFound = boolean;
/** Raw DOM element count from Playwright locator.count(). */
type ElementCount = number;

/** Timeout for private-customers split navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;

// ── PRE: discover reveal elements ────────────────────────────────────────────────

/**
 * Check if any WK.HOME.REVEAL text candidate exists in the DOM (attached but possibly hidden).
 * @param page - Active Playwright page.
 * @returns True if at least one candidate is attached to the DOM.
 */
async function isRevealAttached(page: Page): Promise<boolean> {
  const textCandidates = (WK.HOME.REVEAL as readonly SelectorCandidate[]).filter(
    (c): ElementFound => c.kind === 'textContent',
  );
  const countPromises = textCandidates.map(
    (c): Promise<ElementCount> =>
      page
        .getByText(c.value)
        .first()
        .count()
        .catch((): ElementCount => 0),
  );
  const counts = await Promise.all(countPromises);
  return counts.some((n): ElementFound => n > 0);
}

/**
 * Probe WK.HOME.REVEAL and return RevealStatus: READY | OBSCURED | NOT_FOUND.
 * READY = visible, OBSCURED = in DOM but not visible (e.g. aria-hidden via UserWay).
 * @param mediator - Active mediator.
 * @param page - Active page (for attached-state fallback probe).
 * @param timeout - Race timeout ms.
 * @returns RevealStatus for this discovery pass.
 */
async function probeRevealStatus(
  mediator: IElementMediator,
  page: Page,
  timeout: number,
): Promise<RevealStatus> {
  const candidates = WK.HOME.REVEAL as unknown as readonly SelectorCandidate[];
  const visiblePromise = mediator.resolveVisible(candidates, timeout);
  const visibleResult = await visiblePromise.catch((): false => false);
  if (visibleResult && visibleResult.found) return 'READY';
  const isAttached = await isRevealAttached(page);
  if (isAttached) return 'OBSCURED';
  return 'NOT_FOUND';
}

/**
 * Execute PRE step: close overlays + DISCOVER reveal element status.
 * Stores discovery in context — ACTION reads it instead of re-scanning.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Context enriched with findLoginAreaDiscovery.
 */
async function executeFindLoginAreaPre(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has)
    return fail(ScraperErrorTypes.Generic, 'No browser for FIND_LOGIN_AREA PRE');
  if (!input.mediator.has)
    return fail(ScraperErrorTypes.Generic, 'No mediator for FIND_LOGIN_AREA PRE');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  await tryClosePopup(mediator); // only allowed action in PRE
  const privateCustomers = await probeRevealStatus(mediator, page, 3_000);
  const credentialArea = await probeRevealStatus(mediator, page, DISCOVER_TIMEOUT);
  const discovery: IFindLoginAreaDiscovery = { privateCustomers, credentialArea };
  return succeed({ ...input, findLoginAreaDiscovery: some(discovery) });
}

// ── ACTION: actuate based on PRE discovery status ─────────────────────────────────

/**
 * Fire reveal clicks based on PRE discovery — skips NOT_FOUND entries.
 * @param mediator - Active mediator.
 * @param page - Active page.
 * @param discovery - PRE discovery results.
 * @returns False (best-effort — always resolves).
 */
async function fireRevealClicks(
  mediator: IElementMediator,
  page: Page,
  discovery: IFindLoginAreaDiscovery,
): Promise<false> {
  if (discovery.privateCustomers !== 'NOT_FOUND') {
    await tryClickPrivateCustomers(mediator, page, REVEAL_NAV_TIMEOUT);
  }
  if (discovery.credentialArea !== 'NOT_FOUND') {
    await tryClickCredentialArea(mediator);
  }
  return false;
}

/**
 * Execute ACTION step: actuates ONLY if PRE returned READY or OBSCURED.
 * OBSCURED → force:true already applied by mediator's attached-fallback in resolveAndClick.
 * NOT_FOUND → step is skipped.
 * @param ctx - Pipeline context with login config (preAction hook).
 * @param input - Pipeline context with findLoginAreaDiscovery from PRE.
 * @returns Same context (clicks are side-effects).
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
  if (input.findLoginAreaDiscovery.has) {
    await fireRevealClicks(mediator, page, input.findLoginAreaDiscovery.value);
  }
  const config = ctx.config as unknown as ILoginConfig;
  if (config.preAction) await config.preAction(page).catch((): false => false);
  return succeed(input);
}

// ── POST: validate form is ready + emit Phase-Gate signal ─────────────────────────

/**
 * Execute POST step: confirm form is interactive → emit loginAreaReady=true.
 * Phase-Gate Gatekeeper: LOGIN aborts immediately if this step fails.
 * @param ctx - Pipeline context with login config (checkReadiness hook).
 * @param input - Pipeline context with browser + mediator.
 * @returns Context with loginAreaReady=true.
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
  if (config.checkReadiness) await config.checkReadiness(page).catch((): false => false);
  return succeed({ ...input, loginAreaReady: true });
}

// ── Step definitions + phase factory ─────────────────────────────────────────────

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
 * PRE: discover (Eyes) · ACTION: actuate on discovery · POST: validate (Gatekeeper).
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
