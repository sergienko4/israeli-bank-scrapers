/**
 * PRE-LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_PRELOGIN via PreLoginActions + PreLoginRevealProbe.
 *
 * PRE:    locate navigation to login area (reveal toggle). Some banks don't hide it.
 * ACTION: click reveal, navigate
 * POST:   validate form is visible (password + submit)
 * FINAL:  prove login form is loaded → signal to LOGIN
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import type { IFindLoginAreaDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import {
  isFormAlreadyVisible,
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  validateFormGatePost,
} from './PreLoginActions.js';
import { probeRevealStatus } from './PreLoginRevealProbe.js';

/** Timeout for reveal discovery. */
const DISCOVER_TIMEOUT = 15_000;
/** Timeout for private-customers reveal navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;

/**
 * PRE: Locate reveal toggles. If form already visible → skip.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Updated context with findLoginAreaDiscovery.
 */
async function executePreLocateReveal(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  process.stderr.write(`    [PRE-LOGIN.PRE] URL=${mediator.getCurrentUrl()}\n`);
  if (await isFormAlreadyVisible(mediator)) {
    process.stderr.write('    [PRE-LOGIN.PRE] form ALREADY VISIBLE\n');
    const noReveal: IFindLoginAreaDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
    };
    return succeed({ ...input, findLoginAreaDiscovery: some(noReveal) });
  }
  process.stderr.write('    [PRE-LOGIN.PRE] probing reveal\n');
  const privateCustomers = await probeRevealStatus(mediator, DISCOVER_TIMEOUT);
  const credentialArea = await probeRevealStatus(mediator, DISCOVER_TIMEOUT);
  const discovery: IFindLoginAreaDiscovery = { privateCustomers, credentialArea };
  return succeed({ ...input, findLoginAreaDiscovery: some(discovery) });
}

/**
 * ACTION: Fire reveal clicks based on PRE discovery.
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @param input - Pipeline context with discovery.
 * @returns Succeed with input.
 */
async function executeFireRevealClicks(
  mediator: IElementMediator,
  page: Page,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const disc = input.findLoginAreaDiscovery.has && input.findLoginAreaDiscovery.value;
  if (disc && disc.privateCustomers !== 'NOT_FOUND') {
    await tryClickPrivateCustomers(mediator, page, REVEAL_NAV_TIMEOUT);
  }
  if (disc && disc.credentialArea !== 'NOT_FOUND') {
    await tryClickCredentialArea(mediator);
  }
  const hasPwd = await isFormAlreadyVisible(mediator);
  const iframeCount = page.frames().length - 1;
  const pwdTag = String(hasPwd);
  const iframeTag = String(iframeCount);
  process.stderr.write(`    [PRE-LOGIN.ACTION] pwd=${pwdTag} iframes=${iframeTag}\n`);
  return succeed(input);
}

/**
 * POST: Validate login form is visible (password field found).
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Succeed with loginAreaReady=true, or fail.
 */
async function executeValidateForm(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const isReady = await validateFormGatePost(mediator);
  if (!isReady) {
    process.stderr.write('    [PRE-LOGIN.POST] FAIL: no password field\n');
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN: no password field');
  }
  process.stderr.write(`    [PRE-LOGIN.POST] FOUND at ${mediator.getCurrentUrl()}\n`);
  return succeed({ ...input, loginAreaReady: true });
}

/**
 * FINAL: Prove login form is loaded → signal to LOGIN.
 * Validates loginAreaReady was set by POST.
 * @param input - Pipeline context.
 * @returns Succeed if ready, fail if not.
 */
function executeSignalToLogin(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.loginAreaReady) {
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN FINAL: login form not ready');
  }
  process.stderr.write('    [PRE-LOGIN.FINAL] login form READY → signal to LOGIN\n');
  return succeed(input);
}

export {
  executeFireRevealClicks,
  executePreLocateReveal,
  executeSignalToLogin,
  executeValidateForm,
};
