/**
 * HOME phase — navigate from home page URL to the login page.
 *
 * Responsibility: get the browser from CFG.urls.base to the login URL.
 * Nothing beyond navigation belongs here.
 *
 * PRE:    goto(urls.base) — "Homepage unreachable" on failure
 * ACTION: tryClosePopup → discover + click login link (WK.HOME.ENTRY)
 * POST:   store discovered loginUrl in diagnostics
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator, IRaceResult } from '../Mediator/ElementMediator.js';
import { WK } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { some } from '../Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import { tryClickLoginLinkWithHref, tryClosePopup } from './GenericPreLoginSteps.js';

// ── PRE: navigate to homepage ─────────────────────────────

/**
 * Execute PRE step: navigate to homepage.
 * @param _ctx - Pipeline context (unused).
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

// ── ACTION: click the login link on the home page ─────────

/**
 * Execute ACTION step: clear overlays then navigate to the login URL.
 * tryClosePopup (only allowed action in PRE/ACTION) → tryClickLoginLinkWithHref.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Same context (navigation is side-effect).
 */
async function executeHomeAction(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME ACTION');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME ACTION');
  const mediator = input.mediator.value;
  await tryClosePopup(mediator);
  await tryClickLoginLinkWithHref(mediator);
  return succeed(input);
}

// ── POST: record login URL ────────────────────────────────

/**
 * Execute POST step: store the login URL in diagnostics.
 * Validates we left the home page by recording the new URL.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser.
 * @returns Updated context with diagnostics.loginUrl populated.
 */
async function executeHomePost(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME POST');
  const currentUrl = input.browser.value.page.url();
  const loginUrl = await Promise.resolve(currentUrl);
  const updatedDiag = { ...input.diagnostics, loginUrl };
  return succeed({ ...input, diagnostics: updatedDiag });
}

// ── Step definitions + phase factory ─────────────────────

const HOME_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-pre',
  execute: executeHomePre,
};

const HOME_ACTION_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-action',
  execute: executeHomeAction,
};

const HOME_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home-post',
  execute: executeHomePost,
};

// ── Exported helper for FindLoginAreaPhase ────────────────

/**
 * Probe for a credential field to confirm the form is present.
 * Used by FindLoginAreaPhase.POST.
 * @param mediator - Active mediator.
 * @returns Procedure with IRaceResult — found=true if form field detected.
 */
export async function waitForCredentialsForm(
  mediator: IElementMediator,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK.HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
  return mediator.resolveAndClick(candidates);
}

/**
 * Legacy monolithic step (backward compat) — calls PRE → ACTION → POST.
 * @param ctx - Pipeline context.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.loginUrl populated.
 */
async function executeHome(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const pre = await executeHomePre(ctx, input);
  if (!pre.success) return pre;
  const action = await executeHomeAction(pre.value, pre.value);
  if (!action.success) return action;
  return await executeHomePost(action.value, action.value);
}

const HOME_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home',
  execute: executeHome,
};

/**
 * Create the HOME phase (PRE: goto · ACTION: close+click login link · POST: store loginUrl).
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
