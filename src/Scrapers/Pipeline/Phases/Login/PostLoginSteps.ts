/**
 * Post-login step — wait for settle, check errors, run postAction.
 * Extracted from LoginSteps.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { hasPipelinePostAction } from '../../Types/PipelineLoginConfig.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Timeout for post-login page settle (networkidle). */
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
 * Execute a callback safely, wrapping exceptions as Procedure failure.
 * @param action - The async callback to execute.
 * @returns Succeed or failure Procedure.
 */
async function safeAction(action: () => Promise<void>): Promise<Procedure<void>> {
  try {
    await action();
    return succeed(undefined);
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `Post-login: ${msg}`);
  }
}

/**
 * Wrap a legacy postAction as an async callback.
 * @param fn - Legacy post-action function.
 * @param page - Browser page.
 * @returns Async callback.
 */
function wrapLegacy(fn: (page: Page) => Promise<void>, page: Page): () => Promise<void> {
  return async (): Promise<void> => {
    await fn(page);
  };
}

/**
 * Resolve the post-action callback function if any.
 * @param browserPage - Browser page.
 * @param config - Login config.
 * @param ctx - Pipeline context.
 * @returns Async callback or false.
 */
function resolvePostAction(
  browserPage: Page,
  config: ILoginConfig,
  ctx: IPipelineContext,
): (() => Promise<void>) | false {
  const hasPipelineCtx = hasPipelinePostAction(config);
  const ctxFn = hasPipelineCtx && config.postActionWithCtx;
  if (ctxFn)
    return async (): Promise<void> => {
      await ctxFn(browserPage, ctx);
    };
  if (!config.postAction) return false;
  return wrapLegacy(config.postAction, browserPage);
}

/**
 * Run postAction callback if provided.
 * @param browserPage - Browser page.
 * @param config - Login config.
 * @param ctx - Pipeline context.
 * @returns Success or failure Procedure.
 */
async function runCallback(
  browserPage: Page,
  config: ILoginConfig,
  ctx: IPipelineContext,
): Promise<Procedure<void>> {
  const action = resolvePostAction(browserPage, config, ctx);
  if (!action) return succeed(undefined);
  return safeAction(action);
}

/**
 * Wait for loading, check for form errors.
 * @param mediator - Element mediator.
 * @param activeFrame - Login frame.
 * @returns Failure if errors found.
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
 * @returns Success or login error with specific errorType.
 */
async function executePostLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for postLogin');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login state for postLogin');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for postLogin');
  const formError = await checkFormErrors(input.mediator.value, input.login.value.activeFrame);
  if (formError) return formError;
  await waitForSubmitToSettle(input.mediator.value);
  const result = await runCallback(input.browser.value.page, config, input);
  if (!result.success) return result;
  return succeed(input);
}

/**
 * Create the postLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: wait + mediator error check + postAction.
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

export { createPostLoginStep };
