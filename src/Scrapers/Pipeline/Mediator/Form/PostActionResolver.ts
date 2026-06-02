/**
 * Post-action resolver — resolves and runs postAction/postActionWithCtx callbacks.
 * Moved from PostLoginSteps to Mediator (no line limit here).
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import {
  hasPipelinePostAction,
  type IPipelineLoginConfig,
} from '../../Types/PipelineLoginConfig.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/**
 * Execute a callback safely, wrapping exceptions as Procedure failure.
 * @param action - The async callback to execute.
 * @returns Succeed or failure Procedure.
 */
async function safeAction(action: () => Promise<void>): Promise<Procedure<void>> {
  try {
    await action();
    return succeed(undefined);
  } catch (error) {
    return fail(ScraperErrorTypes.Generic, `Post-login: ${toErrorMessage(error as Error)}`);
  }
}

/**
 * Wrap a pipeline-aware postActionWithCtx into a zero-arg async callback.
 * @param fn - The user-provided callback bound to a fresh closure.
 * @param browserPage - Browser page to pass through.
 * @param ctx - Pipeline context to pass through.
 * @returns Zero-arg async wrapper invoking `fn(browserPage, ctx)`.
 */
function wrapWithCtx(
  fn: NonNullable<IPipelineLoginConfig['postActionWithCtx']>,
  browserPage: Page,
  ctx: IPipelineContext,
): () => Promise<void> {
  return async (): Promise<void> => {
    await fn(browserPage, ctx);
  };
}

/**
 * Wrap a legacy postAction into a zero-arg async callback.
 * @param fn - The user-provided callback bound to a fresh closure.
 * @param browserPage - Browser page to pass through.
 * @returns Zero-arg async wrapper invoking `fn(browserPage)`.
 */
function wrapLegacy(
  fn: NonNullable<ILoginConfig['postAction']>,
  browserPage: Page,
): () => Promise<void> {
  return async (): Promise<void> => {
    await fn(browserPage);
  };
}

/**
 * Resolve pipeline-aware post-action or legacy postAction callback.
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
  if (hasPipelinePostAction(config) && config.postActionWithCtx) {
    return wrapWithCtx(config.postActionWithCtx, browserPage, ctx);
  }
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
async function runPostCallback(
  browserPage: Page,
  config: ILoginConfig,
  ctx: IPipelineContext,
): Promise<Procedure<void>> {
  const action = resolvePostAction(browserPage, config, ctx);
  if (!action) return succeed(undefined);
  return safeAction(action);
}

export default runPostCallback;
export { runPostCallback };
