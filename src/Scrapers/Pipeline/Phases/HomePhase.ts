/**
 * HOME phase — generic homepage → login page navigation.
 * Uses mediator.resolveAndClick + resolveVisible with WellKnown candidates.
 * Same flow for ALL banks — no bank-specific code.
 * All config via DI (ctx.config) — no static imports of bank config.
 *
 * PRE:    navigate to urls.base (homepage) — error: "Homepage unreachable"
 * ACTION: close popup → href-strategy login link → privateCustomers → credentialArea
 * POST:   wait for credentials form → store discovered loginUrl in diagnostics
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { some } from '../Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import {
  tryClickCredentialArea,
  tryClickLoginLinkWithHref,
  tryClickPrivateCustomers,
  tryClosePopup,
} from './GenericPreLoginSteps.js';

/** Timeout for waiting for navigation after clicking a link. */
const NAV_TIMEOUT = 15000;

// ── PRE: navigate to homepage ─────────────────────────────

/**
 * Execute PRE step: navigate to homepage.
 * Distinct error: "Homepage unreachable: {url}".
 * @param _ctx - Pipeline context (unused, matches step signature).
 * @param input - Pipeline context with browser + config.
 * @returns Updated context, or failure if goto fails.
 */
async function executeHomePre(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME PRE');
  const page = input.browser.value.page;
  const homepageUrl = input.config.urls.base ?? 'about:blank';
  try {
    await page.goto(homepageUrl, { waitUntil: 'domcontentloaded' });
    return succeed(input);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `Homepage unreachable: ${homepageUrl} — ${msg}`);
  }
}

// ── ACTION: navigate to login form ────────────────────────

/**
 * Execute ACTION step: close popup → href-strategy login link → click chain.
 * All interactions via mediator — no direct Playwright.
 * Best-effort: failures at each sub-step are non-fatal (returns succeed).
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Same context (navigation is side-effect on page).
 */
async function executeHomeAction(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME ACTION');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME ACTION');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  await tryClosePopup(mediator);
  await tryClickLoginLinkWithHref(mediator);
  await tryClickPrivateCustomers(mediator, page, NAV_TIMEOUT);
  await tryClickCredentialArea(mediator);
  return succeed(input);
}

// ── POST: verify credentials form + store loginUrl ────────

/**
 * Probe for username field to confirm credentials form is rendered.
 * @param mediator - Element mediator.
 * @returns True if username field found.
 */
async function waitForCredentialsForm(mediator: IElementMediator): Promise<boolean> {
  const candidates = PIPELINE_WELL_KNOWN_LOGIN.username;
  return mediator.resolveAndClick(candidates).catch((): boolean => false);
}

/**
 * Execute POST step: wait for credentials form + store loginUrl.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context with diagnostics.loginUrl populated.
 */
async function executeHomePost(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME POST');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME POST');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  await waitForCredentialsForm(mediator);
  const loginUrl = page.url();
  const updatedDiag = { ...input.diagnostics, loginUrl };
  return succeed({ ...input, diagnostics: updatedDiag });
}

// ── Step definitions ──────────────────────────────────────

/** HOME PRE step — navigate to homepage. */
const HOME_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-pre',
  execute: executeHomePre,
};

/** HOME ACTION step — navigate from homepage to login form. */
const HOME_ACTION_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-action',
  execute: executeHomeAction,
};

/** HOME POST step — verify form + store loginUrl. */
const HOME_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-post',
  execute: executeHomePost,
};

// ── Legacy monolithic step (backward compat) ──────────────

/**
 * Execute the HOME phase as a single step (backward compat).
 * Calls PRE → ACTION → POST sequentially.
 * @param ctx - Pipeline context.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.loginUrl populated.
 */
async function executeHome(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const preResult = await executeHomePre(ctx, input);
  if (!preResult.success) return preResult;
  const actionResult = await executeHomeAction(preResult.value, preResult.value);
  if (!actionResult.success) return actionResult;
  return executeHomePost(actionResult.value, actionResult.value);
}

/** HOME phase step — legacy monolithic (used by actionOnly). */
const HOME_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home',
  execute: executeHome,
};

// ── Phase factory ─────────────────────────────────────────

/**
 * Create the full HOME phase with PRE/ACTION/POST sub-steps.
 * @returns IPhaseDefinition with pre, action, post.
 */
function createHomePhase(): IPhaseDefinition<IPipelineContext, IPipelineContext> {
  return {
    name: 'home',
    pre: some(HOME_PRE_STEP),
    action: HOME_ACTION_STEP,
    post: some(HOME_POST_STEP),
  };
}

export { createHomePhase, HOME_ACTION_STEP, HOME_POST_STEP, HOME_PRE_STEP, HOME_STEP };
export default HOME_STEP;
