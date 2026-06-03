/**
 * LOGIN.POST validator + bounce detector + auth-API failure check.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { runPostCallback } from '../Form/PostActionResolver.js';
import { safeScanFrame } from './LoginFrameScan.js';
import { detectLoginBounce } from './LoginPostBounce.js';
import { validateActionScopeIntact } from './LoginScopeIntact.js';
import { hasStayedOnLoginUrl } from './LoginUrlHelpers.js';
import { waitForPostLoginTraffic } from './PostLoginTrafficProbe.js';

/** Lookup table mapping classifier → human-readable layer label. */
const AUTH_FAILURE_LAYER_LABELS: Partial<Record<string, string>> = {
  'http-4xx': 'HTTP 4xx',
  'body-error': 'body-error',
};

/**
 * Probe the generic auth-failure watcher and convert any captured
 * failure into a Procedure.
 * @param mediator - Element mediator (exposes networkDiscovery).
 * @returns Failure procedure when the watcher fired, false otherwise.
 */
function detectAuthApiFailure(mediator: IElementMediator): Procedure<IPipelineContext> | false {
  const captured = mediator.network.authFailureWatcher.hasFailed();
  if (!captured) return false;
  const layerLabel = AUTH_FAILURE_LAYER_LABELS[captured.classifier] ?? captured.classifier;
  const summary = `Auth API ${layerLabel} (${String(captured.status)}): ${captured.bodyPreview}`;
  return fail(ScraperErrorTypes.InvalidPassword, summary);
}

/** Failure messages for the LOGIN POST early gates. */
const LOGIN_POST_NO_LOGIN_STATE = 'LOGIN POST: no login state';
const LOGIN_POST_NO_BROWSER = 'LOGIN POST: no browser';

/**
 * Run the loading-gate wait + early auth-API watcher.
 * @param mediator - Element mediator.
 * @param activeFrame - LOGIN PRE's captured active frame.
 * @returns Failure procedure on early fail, otherwise `false`.
 */
async function runPostLoadingGate(
  mediator: IElementMediator,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext> | false> {
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  return detectAuthApiFailure(mediator);
}

/** Bundled args for {@link runPostFormScanAndCallback}. */
interface IPostFormScanArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
}

/**
 * Run the main-frame error scan plus the SPA-traffic wait and POST callback.
 * @param args - Bundled mediator + config + context + page.
 * @returns Failure procedure on detected error, otherwise `false`.
 */
async function runPostFormScanAndCallback(
  args: IPostFormScanArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const errors = await safeScanFrame(args.mediator, args.page);
  if (errors.hasErrors) return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  await waitForPostLoginTraffic(args.mediator, args.input.logger);
  const cbResult = await runPostCallback(args.page, args.config, args.input);
  if (!cbResult.success) return cbResult;
  return false;
}

/**
 * Async-page scan helper for {@link detectAsyncLoginErrors}.
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @returns Failure procedure on detected error, otherwise `false`.
 */
async function detectAsyncOnPage(
  mediator: IElementMediator,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  const asyncErrors = await safeScanFrame(mediator, page);
  if (!asyncErrors.hasErrors) return false;
  return fail(ScraperErrorTypes.InvalidPassword, `Form: ${asyncErrors.summary}`);
}

/**
 * Re-scan the MAIN page for error banners that render asynchronously.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure on detected async error, else false.
 */
async function detectAsyncLoginErrors(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  if (!input.browser.has) return false;
  return detectAsyncOnPage(mediator, input.browser.value.page);
}

/**
 * Run the late-fire auth-failure + async DOM detectors.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Resolved Procedure for the late checks.
 */
async function runPostLateChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const lateAuthFail = detectAuthApiFailure(mediator);
  if (lateAuthFail !== false) return lateAuthFail;
  const asyncCheck = await detectAsyncLoginErrors(mediator, input);
  if (asyncCheck !== false) return asyncCheck;
  return runLatePostChecks(mediator, input);
}

/**
 * Runs the post-redirect failure detectors (form-presence + bounce).
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure on detected failure, otherwise `succeed(input)`.
 */
async function runLatePostChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const scopeIntact = await validateActionScopeIntact(mediator, input);
  if (scopeIntact !== false) return scopeIntact;
  const bounce = detectLoginBounce(mediator, input);
  if (bounce !== false) return bounce;
  return succeed(input);
}

/** Bundle for {@link runValidateLoginAfterGates}. */
interface IValidateLoginArgs {
  readonly config: ILoginConfig;
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly activeFrame: Page | Frame;
}

/**
 * Run the form-scan + late-checks half of LOGIN.POST.
 * @param args - Bundled validate-login args.
 * @param page - Browser page.
 * @returns Resolved Procedure.
 */
async function runPostFormAndLateChecks(
  args: IValidateLoginArgs,
  page: Page,
): Promise<Procedure<IPipelineContext>> {
  const formScan = await runPostFormScanAndCallback({ ...args, page });
  if (formScan !== false) return formScan;
  return runPostLateChecks(args.mediator, args.input);
}

/**
 * Run the loading-gate + form/late-checks pipeline.
 * @param args - Bundled validate-login args.
 * @returns Resolved Procedure.
 */
async function runValidateLoginAfterGates(
  args: IValidateLoginArgs,
): Promise<Procedure<IPipelineContext>> {
  const earlyGate = await runPostLoadingGate(args.mediator, args.activeFrame);
  if (earlyGate !== false) return earlyGate;
  return runPostFormAndLateChecks(args, args.page);
}

/** Tagged outcome of {@link checkLoginPostGates}. */
type LoginPostReady =
  | { readonly tag: 'fail'; readonly proc: IProcedureFailure }
  | { readonly tag: 'ok'; readonly page: Page; readonly activeFrame: Page | Frame };

/**
 * Wrap a failure procedure in the LoginPostReady fail tag.
 * @param msg - Failure message.
 * @returns LoginPostReady fail tag.
 */
function failReady(msg: string): LoginPostReady {
  return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, msg) };
}

/**
 * Run the LOGIN.POST early gates (login + browser presence checks).
 * @param input - Pipeline context.
 * @returns Tagged readiness outcome.
 */
function checkLoginPostGates(input: IPipelineContext): LoginPostReady {
  if (!input.login.has) return failReady(LOGIN_POST_NO_LOGIN_STATE);
  if (!input.browser.has) return failReady(LOGIN_POST_NO_BROWSER);
  const { page } = input.browser.value;
  const { activeFrame } = input.login.value;
  return { tag: 'ok', page, activeFrame };
}

/**
 * POST: Validate login.
 * @param config - Login config.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Succeed or fail with error type.
 */
async function executeValidateLogin(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const ready = checkLoginPostGates(input);
  if (ready.tag === 'fail') return ready.proc;
  const { page, activeFrame } = ready;
  return runValidateLoginAfterGates({ config, mediator, input, page, activeFrame });
}

export default executeValidateLogin;
export { detectAsyncLoginErrors, executeValidateLogin };
