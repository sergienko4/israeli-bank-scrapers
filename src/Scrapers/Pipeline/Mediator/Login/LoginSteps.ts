/**
 * Login phase — preLogin/loginAction/postLogin. Generic for ALL banks.
 * Field-fill logic in LoginFillHelpers.ts, post-login in PostLoginSteps.ts.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { none, some } from '../../Types/Option.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { createLoginActionStep } from './LoginSubmitStep.js';
import { createPostLoginStep } from './PostLoginSteps.js';

export type { IFillOpts } from './LoginFillStep.js';
export { waitForSubmitToSettle } from './PostLoginSteps.js';

/**
 * Run checkReadiness callback if provided.
 * @param config - Login config.
 * @param browserPage - Browser page.
 * @returns Success or failure Procedure.
 */
async function runCheckReadiness(
  config: ILoginConfig,
  browserPage: Page,
): Promise<Procedure<true>> {
  if (!config.checkReadiness) return succeed(true);
  try {
    await config.checkReadiness(browserPage);
    return succeed(true);
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `checkReadiness: ${toErrorMessage(err as Error)}`);
  }
}

/**
 * Run preAction callback and return the active frame.
 * @param config - Login config.
 * @param browserPage - Browser page.
 * @returns Frame returned by preAction, or page if none.
 */
async function runPreAction(
  config: ILoginConfig,
  browserPage: Page,
): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(browserPage as Page | Frame);
  try {
    const frame = await config.preAction(browserPage);
    return succeed(frame ?? browserPage);
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `preAction failed: ${toErrorMessage(err as Error)}`);
  }
}

/**
 * Execute the preLogin step body.
 * @param config - Bank's login config.
 * @param input - Current pipeline context.
 * @returns Updated context with login.activeFrame.
 */
async function executePreLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for preLogin');
  const browserPage = input.browser.value.page;
  const readiness = await runCheckReadiness(config, browserPage);
  if (!readiness.success) return readiness;
  const frameResult = await runPreAction(config, browserPage);
  if (!frameResult.success) return frameResult;
  const loginState = { activeFrame: frameResult.value, persistentOtpToken: none() };
  return succeed({ ...input, login: some(loginState) });
}

/**
 * Create the preLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: checkReadiness + preAction + set activeFrame.
 */
function createPreLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'pre-login',
    /** @inheritdoc */
    execute: async (
      _: IPipelineContext,
      i: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> => await executePreLogin(config, i),
  };
}

/** Login phase with pre/action/post. */
interface ILoginPhase {
  readonly pre: IPipelineStep<IPipelineContext, IPipelineContext>;
  readonly action: IPipelineStep<IPipelineContext, IPipelineContext>;
  readonly post: IPipelineStep<IPipelineContext, IPipelineContext>;
}

/**
 * Create the full login phase from ILoginConfig.
 * @param config - Bank's login configuration.
 * @returns Pre, action, and post login steps.
 */
function createLoginPhase(config: ILoginConfig): ILoginPhase {
  return {
    pre: createPreLoginStep(config),
    action: createLoginActionStep(config),
    post: createPostLoginStep(config),
  };
}

export { createLoginActionStep, createLoginPhase, createPostLoginStep, createPreLoginStep };
