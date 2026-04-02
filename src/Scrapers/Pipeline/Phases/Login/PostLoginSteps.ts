/**
 * Post-login step — wait for SSO/traffic, check errors, run postAction.
 * Patient Observer: waits for organic SPA traffic from iframe SSO redirect.
 * All callback resolution delegated to Mediator/Form/PostActionResolver.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { waitForPostLoginTraffic } from '../../Mediator/Auth/PostLoginTrafficProbe.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { runPostCallback } from '../../Mediator/Form/PostActionResolver.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

const SETTLE_TIMEOUT = 15000;

/**
 * Wait for networkidle after form submission.
 * @param mediator - Element mediator.
 * @returns Succeed after settling or timeout.
 */
export async function waitForSubmitToSettle(mediator: IElementMediator): Promise<Procedure<void>> {
  return mediator.waitForNetworkIdle(SETTLE_TIMEOUT);
}

/**
 * Wait for loading, check for form errors.
 * @param mediator - Element mediator.
 * @param activeFrame - Login frame.
 * @returns Failure if errors found, false otherwise.
 */
async function checkFormErrors(
  mediator: IElementMediator,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext> | false> {
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  const errors = await mediator.discoverErrors(activeFrame);
  if (errors.hasErrors) return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  return false;
}

/**
 * Execute the postLogin step body.
 * @param config - Bank's login config.
 * @param input - Context from loginAction.
 * @returns Success or login error.
 */
async function executePostLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login state');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  const mediator = input.mediator.value;
  const formError = await checkFormErrors(mediator, input.login.value.activeFrame);
  if (formError) return formError;
  await waitForPostLoginTraffic(mediator);
  const cbResult = await runPostCallback(input.browser.value.page, config, input);
  if (!cbResult.success) return cbResult;
  return succeed(input);
}

/**
 * Create the postLogin step from config.
 * @param config - Bank's login config.
 * @returns Pipeline step for post-login validation.
 */
function createPostLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'post-login',
    /** @inheritdoc */
    execute: async (
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> => await executePostLogin(config, input),
  };
}

export { executeLoginSignal } from '../../Mediator/Auth/LoginSignalProbe.js';

export { createPostLoginStep };
