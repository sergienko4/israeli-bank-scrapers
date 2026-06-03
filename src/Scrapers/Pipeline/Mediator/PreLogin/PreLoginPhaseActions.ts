/**
 * PRE-LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_PRELOGIN via PreLoginActions + PreLoginRevealProbe.
 *
 * <p>Phase 2d strict-cluster split: reveal-discovery moved to
 * {@link ./PreLoginRevealDiscovery.ts}; sealed reveal-action dispatch
 * moved to {@link ./PreLoginSealedReveal.ts}. This entry-point file
 * keeps the legacy full-context reveal-click orchestration plus the
 * POST/FINAL stages and the public re-export surface.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext, IPreLoginDiscovery } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import {
  isFormAlreadyVisible,
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  validateFormGatePost,
} from './PreLoginActions.js';

/** Timeout for private-customers reveal navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;

/** Bundled args for `executeFireRevealClicks` reveal-click probes. */
interface IFireRevealArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
  readonly disc: IPreLoginDiscovery | false;
}

/**
 * Run the `privateCustomers` reveal-click branch when the discovery
 * payload says it matched.
 * @param args - Bundled mediator + page + logger + discovery payload.
 * @returns True when the click attempt fired, false when skipped.
 */
async function runPrivateCustomersBranch(args: IFireRevealArgs): Promise<boolean> {
  const { mediator, page, logger, disc } = args;
  if (!disc || disc.privateCustomers === 'NOT_FOUND') return false;
  const clickArgs = { mediator, browserPage: page, navTimeout: REVEAL_NAV_TIMEOUT, logger };
  await tryClickPrivateCustomers(clickArgs);
  return true;
}

/**
 * Run the two reveal-click attempts (`privateCustomers` then
 * `credentialArea`) whenever the discovery payload says they matched.
 * @param args - Bundled mediator + page + logger + discovery payload.
 * @returns True after both branches have either run or skipped.
 */
async function runRevealClicks(args: IFireRevealArgs): Promise<true> {
  const { mediator, logger, disc } = args;
  await runPrivateCustomersBranch(args);
  if (disc && disc.credentialArea !== 'NOT_FOUND') await tryClickCredentialArea(mediator, logger);
  return true;
}

/**
 * Emit the post-fire form-gate probe diagnostic.
 * @param mediator - Element mediator.
 * @param page - Browser page (for iframe count).
 * @param logger - Pipeline logger.
 * @returns True after the event is emitted.
 */
async function logPostFireProbe(
  mediator: IElementMediator,
  page: Page,
  logger: IPipelineContext['logger'],
): Promise<true> {
  const hasPwd = await isFormAlreadyVisible(mediator, logger);
  logger.debug({ hasPwd, iframes: page.frames().length - 1 });
  return true;
}

/**
 * Run the reveal-click probes then emit the post-fire form-gate
 * diagnostic. Side-effect only.
 * @param args - Bundled mediator + page + logger + discovery payload.
 * @returns True after both steps complete.
 */
async function fireAndProbe(args: IFireRevealArgs): Promise<true> {
  await runRevealClicks(args);
  await logPostFireProbe(args.mediator, args.page, args.logger);
  return true;
}

/**
 * ACTION: Fire reveal clicks (legacy — full context).
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
  const logger = input.logger;
  const disc = input.preLoginDiscovery.has && input.preLoginDiscovery.value;
  await fireAndProbe({ mediator, page, logger, disc });
  return succeed(input);
}

/**
 * Log the FORM_GATE-validated URL once POST has confirmed the form
 * is interactable.
 * @param mediator - Element mediator (for current URL).
 * @param logger - Pipeline logger.
 * @returns True after the masked URL is emitted.
 */
function logValidatedFormUrl(mediator: IElementMediator, logger: IPipelineContext['logger']): true {
  const validatedUrl = mediator.getCurrentUrl();
  const maskedUrl = maskVisibleText(validatedUrl);
  logger.debug({ text: maskedUrl });
  return true;
}

/**
 * Fail-loud branch for the POST validation when the password field
 * never appeared. Extracted so {@link executeValidateForm} stays
 * inside the 10-LoC ceiling.
 * @param input - Pipeline context.
 * @returns Failure Procedure with the "no password field" message.
 */
function failNoPasswordField(input: IPipelineContext): Procedure<IPipelineContext> {
  input.logger.debug({ hasPwd: false, iframes: 0 });
  return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN: no password field');
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
  if (!isReady) return failNoPasswordField(input);
  logValidatedFormUrl(mediator, input.logger);
  return succeed({ ...input, loginAreaReady: true });
}

/**
 * FINAL: Prove login form is loaded → signal to LOGIN.
 * @param input - Pipeline context.
 * @returns Succeed if ready, fail if not.
 */
function executeSignalToLogin(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.loginAreaReady) {
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN FINAL: login form not ready');
  }
  input.logger.debug({ message: 'login form READY → signal to LOGIN' });
  return succeed(input);
}

export { executePreLocateReveal } from './PreLoginRevealDiscovery.js';
export { executeFireRevealClicksSealed } from './PreLoginSealedReveal.js';
export { executeFireRevealClicks, executeSignalToLogin, executeValidateForm };
