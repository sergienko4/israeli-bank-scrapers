/**
 * LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    discover credential form (checkReadiness + preAction)
 * ACTION: fill fields + submit (delegated to LoginFormActions)
 * POST:   validate OK or error (error discovery + traffic wait)
 * FINAL:  prove dashboard loaded → signal to DASHBOARD (cookie audit + API strategy)
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { none, some } from '../../Types/Option.js';
import type { ILoginState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { waitForPostLoginTraffic } from '../Auth/PostLoginTrafficProbe.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { fillAndSubmit } from '../Form/LoginFormActions.js';
import { runPostCallback } from '../Form/PostActionResolver.js';

/**
 * Run checkReadiness if configured — returns failure Procedure or false.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Failure Procedure on error, false on success/skip.
 */
async function runCheckReadiness(
  config: ILoginConfig,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  if (!config.checkReadiness) return false;
  try {
    await config.checkReadiness(page);
    return false;
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
  }
}

/**
 * Run preAction if configured — returns the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame), or failure Procedure.
 */
async function runPreAction(
  config: ILoginConfig,
  page: Page,
): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const frame = await config.preAction(page);
    const activeFrame: Page | Frame = frame ?? page;
    return succeed(activeFrame);
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: preAction — ${msg}`);
  }
}

/**
 * PRE: Discover credential form — run checkReadiness + preAction.
 * Sets login.activeFrame for ACTION to fill into.
 * @param config - Login config.
 * @param input - Pipeline context with browser.
 * @returns Updated context with login state.
 */
async function executeDiscoverForm(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no browser');
  const page = input.browser.value.page;
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck) return readyCheck;
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return frameResult;
  const activeFrame = frameResult.value;
  const loginState: ILoginState = { activeFrame, persistentOtpToken: none() };
  process.stderr.write(`    [LOGIN.PRE] activeFrame=${activeFrame.url().slice(0, 60)}\n`);
  return succeed({ ...input, login: some(loginState) });
}

/**
 * ACTION: Fill credential fields + submit form.
 * @param config - Login config with fields + submit.
 * @param mediator - Element mediator.
 * @param input - Pipeline context with credentials.
 * @returns Updated context with submitMethod in diagnostics.
 */
async function executeFillAndSubmit(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: not ready');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: no login state');
  const creds = input.credentials as Record<string, string>;
  const result = await fillAndSubmit(mediator, config, creds);
  if (!result.success) return result;
  const diag = { ...input.diagnostics, submitMethod: result.value.method };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * POST: Validate login — check for form errors, wait for SPA traffic.
 * @param config - Login config with postAction callback.
 * @param mediator - Element mediator.
 * @param input - Pipeline context with login state + browser.
 * @returns Succeed or fail with error type.
 */
async function executeValidateLogin(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no login state');
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no browser');
  const activeFrame = input.login.value.activeFrame;
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  const errors = await mediator.discoverErrors(activeFrame);
  if (errors.hasErrors) {
    return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  }
  await waitForPostLoginTraffic(mediator);
  const cbResult = await runPostCallback(input.browser.value.page, config, input);
  if (!cbResult.success) return cbResult;
  return succeed(input);
}

export { executeDiscoverForm, executeFillAndSubmit, executeValidateLogin };
export { executeLoginSignal } from '../Auth/LoginSignalProbe.js';
