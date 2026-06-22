/**
 * LOGIN.POST early-gate primitives + form-scan helper.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPostValidate.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { runPostCallback } from '../../Form/PostActionResolver.js';
import { safeScanFrame } from '../LoginFrameScan.js';
import { waitForPostLoginTraffic } from '../PostLoginTrafficProbe.js';
import { detectAuthApiFailure } from './PostValidateDetect.js';

/** Failure messages for the LOGIN POST early gates. */
export const LOGIN_POST_NO_LOGIN_STATE = 'LOGIN POST: no login state';
export const LOGIN_POST_NO_BROWSER = 'LOGIN POST: no browser';

/** Bundled args for {@link runPostFormScanAndCallback}. */
export interface IPostFormScanArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
}

/** Tagged outcome of {@link checkLoginPostGates}. */
export type LoginPostReady =
  | { readonly tag: 'fail'; readonly proc: IProcedureFailure }
  | { readonly tag: 'ok'; readonly page: Page; readonly activeFrame: Page | Frame };

/**
 * Wrap a failure procedure in the LoginPostReady fail tag.
 * @param msg - Failure message.
 * @returns LoginPostReady fail tag.
 */
export function failReady(msg: string): LoginPostReady {
  return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, msg) };
}

/**
 * Run the LOGIN.POST early gates (login + browser presence checks).
 * @param input - Pipeline context.
 * @returns Tagged readiness outcome.
 */
export function checkLoginPostGates(input: IPipelineContext): LoginPostReady {
  if (!input.login.has) return failReady(LOGIN_POST_NO_LOGIN_STATE);
  if (!input.browser.has) return failReady(LOGIN_POST_NO_BROWSER);
  const { page } = input.browser.value;
  const { activeFrame } = input.login.value;
  return { tag: 'ok', page, activeFrame };
}

/**
 * Run the loading-gate wait + early auth-API watcher.
 * @param mediator - Element mediator.
 * @param activeFrame - LOGIN PRE's captured active frame.
 * @returns Failure procedure on early fail, otherwise `false`.
 */
export async function runPostLoadingGate(
  mediator: IElementMediator,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext> | false> {
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  return detectAuthApiFailure(mediator);
}

/**
 * Enforce the auth-confirm gate when the bank opts in via loginAuthConfirmMs.
 * Returns a Timeout failure when opted-in but no authenticated accounts
 * traffic was observed within the budget; returns false otherwise (legacy
 * advisory path for banks with no loginAuthConfirmMs set).
 * @param args - Bundled mediator + config + context + page.
 * @returns Timeout failure when opted-in and traffic absent, else false.
 */
async function enforceAuthConfirm(
  args: IPostFormScanArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const { loginAuthConfirmMs: confirmMs } = args.input.config;
  const wasAuth = await waitForPostLoginTraffic(args.mediator, args.input.logger, confirmMs);
  if (confirmMs !== undefined && !wasAuth)
    return fail(ScraperErrorTypes.Timeout, 'LOGIN.POST: no accounts traffic within auth budget');
  return false;
}

/**
 * Run the auth-confirm gate and the post-login callback in sequence.
 * @param args - Bundled mediator + config + context + page.
 * @returns Failure on auth-confirm miss or callback error, else false.
 */
async function runPostLoginSequence(
  args: IPostFormScanArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const authFail = await enforceAuthConfirm(args);
  if (authFail) return authFail;
  const cbResult = await runPostCallback(args.page, args.config, args.input);
  if (!cbResult.success) return cbResult;
  return false;
}

/**
 * Run the main-frame error scan plus the SPA-traffic wait and POST callback.
 * @param args - Bundled mediator + config + context + page.
 * @returns Failure procedure on detected error, otherwise `false`.
 */
export async function runPostFormScanAndCallback(
  args: IPostFormScanArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const errors = await safeScanFrame(args.mediator, args.page);
  if (errors.hasErrors) return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  return runPostLoginSequence(args);
}
