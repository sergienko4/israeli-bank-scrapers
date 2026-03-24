/**
 * HOME phase — generic homepage → login page navigation.
 * Uses mediator.resolveAndClick with WellKnown candidates.
 * Same flow for ALL banks — no bank-specific code.
 * All config via DI (ctx.config) — no static imports of bank config.
 *
 * pre:    navigate to urls.base (homepage)
 * action: close popup → click login link → click privateCustomers → wait nav
 *         click loginMethodTab
 * post:   store discovered loginUrl in diagnostics → wait for login form
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../Registry/PipelineWellKnown.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import {
  tryClickCredentialArea,
  tryClickLoginLink,
  tryClickPrivateCustomers,
  tryClosePopup,
} from './GenericPreLoginSteps.js';

/** Timeout for waiting for navigation after clicking a link. */
const NAV_TIMEOUT = 15000;

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
 * Navigate from homepage to login form via mediator clicks.
 * @param page - Playwright page.
 * @param mediator - Element mediator.
 * @returns Discovered login URL after navigation.
 */
async function navigateToLoginForm(page: Page, mediator: IElementMediator): Promise<string> {
  await tryClosePopup(mediator);
  await tryClickLoginLink(mediator);
  await tryClickPrivateCustomers(mediator, page, NAV_TIMEOUT);
  await tryClickCredentialArea(mediator);
  await waitForCredentialsForm(mediator);
  return page.url();
}

/**
 * Execute the HOME phase: navigate from homepage to login form.
 * All interactions via mediator.resolveAndClick — no direct HTML access.
 * @param _ctx - Pipeline context (unused, matches step signature).
 * @param input - Pipeline context with browser + mediator + config.
 * @returns Updated context with diagnostics.loginUrl populated.
 */
async function executeHome(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for HOME');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for HOME');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  const homepageUrl = input.config.urls.base ?? 'about:blank';
  try {
    await page.goto(homepageUrl, { waitUntil: 'domcontentloaded' });
    const loginUrl = await navigateToLoginForm(page, mediator);
    const updatedDiag = { ...input.diagnostics, loginUrl };
    return succeed({ ...input, diagnostics: updatedDiag });
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `HOME phase failed: ${msg}`);
  }
}

/** HOME phase step — generic homepage navigation. */
const HOME_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'home',
  execute: executeHome,
};

export default HOME_STEP;
export { HOME_STEP };
