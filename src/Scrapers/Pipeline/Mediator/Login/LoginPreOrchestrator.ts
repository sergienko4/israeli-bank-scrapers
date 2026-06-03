/**
 * LOGIN PRE orchestrator — readiness probe, preAction callback,
 * neterror probe, field-discovery commit.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, some } from '../../Types/Option.js';
import {
  type ILoginFieldDiscovery,
  type ILoginState,
  type IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IPreludeSpec } from '../Elements/PagePrelude.js';
import { awaitFramePrelude, probeFirefoxNeterror } from '../Elements/PagePrelude.js';
import { ELEMENTS_DOM_READY_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import { executeDiscoverFields, type IDiscoverFieldsArgs } from './LoginFieldDiscovery.js';

/** Failure messages for the LOGIN PRE gates. */
const LOGIN_PRE_NO_BROWSER = 'LOGIN PRE: no browser';
const LOGIN_PRE_NO_MEDIATOR = 'LOGIN PRE: no mediator';

/** LOGIN.PRE prelude spec — DOM-ready ceiling for the iframe-hosted login form. */
const LOGIN_PRE_FRAME_PRELUDE: IPreludeSpec = {
  level: 'dom',
  timeoutMs: ELEMENTS_DOM_READY_TIMEOUT_MS,
};

/**
 * Build a fail procedure for the checkReadiness catch arm.
 * @param error - Caught error from the readiness callback.
 * @returns Failure procedure tagged Generic.
 */
function failCheckReadiness(error: unknown): IProcedureFailure {
  const msg = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
}

/**
 * Await the verified checkReadiness callback — resolves to `false`
 * (no failure) when the callback returns.
 * @param checkReadiness - Verified-present callback.
 * @param page - Browser page.
 * @returns Always `false` on success.
 */
async function performCheckReadiness(
  checkReadiness: NonNullable<ILoginConfig['checkReadiness']>,
  page: Page,
): Promise<false> {
  await checkReadiness(page);
  return false;
}

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
  return performCheckReadiness(config.checkReadiness, page).catch(failCheckReadiness);
}

/**
 * Invoke the optional preAction callback and select the active frame.
 * @param preAction - Verified-present preAction callback.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame).
 */
async function performPreAction(
  preAction: NonNullable<ILoginConfig['preAction']>,
  page: Page,
): Promise<Page | Frame> {
  const frame = await preAction(page);
  return frame ?? page;
}

/**
 * Run preAction if configured — returns the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Active frame, or failure Procedure.
 */
async function runPreAction(config: ILoginConfig, page: Page): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const activeFrame = await performPreAction(config.preAction, page);
    return succeed(activeFrame);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: preAction — ${msg}`);
  }
}

/**
 * Probe the page for a Firefox-style network-error chrome.
 * @param page - Browser page.
 * @returns Failure procedure when detected, `false` otherwise.
 */
async function probeNeterrorAndFail(page: Page): Promise<Procedure<IPipelineContext> | false> {
  const probe = await probeFirefoxNeterror(page);
  if (!probe.isNeterror) return false;
  const pageUrl = page.url();
  const maskedUrl = maskVisibleText(pageUrl);
  const msg = `LOGIN PRE: browser error page — title="${probe.title}" url=${maskedUrl}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/** Outcome of {@link runDiscoverFormPreamble}. */
type DiscoverFormPreamble =
  | { readonly tag: 'fail'; readonly proc: Procedure<IPipelineContext> }
  | { readonly tag: 'frame'; readonly activeFrame: Page | Frame };

/**
 * Run LOGIN.PRE's optional readiness + preAction callbacks.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Tagged outcome.
 */
async function runDiscoverFormPreamble(
  config: ILoginConfig,
  page: Page,
): Promise<DiscoverFormPreamble> {
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck !== false) return { tag: 'fail', proc: readyCheck };
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return { tag: 'fail', proc: frameResult };
  return { tag: 'frame', activeFrame: frameResult.value };
}

/**
 * Build LOGIN.PRE's login state and emit the active-frame trace log.
 * @param activeFrame - Frame selected by preAction.
 * @param page - Browser page.
 * @param logger - Pipeline logger.
 * @returns Freshly built login state value.
 */
function buildLoginState(
  activeFrame: Page | Frame,
  page: Page,
  logger: IPipelineContext['logger'],
): ILoginState {
  logger.debug({ message: maskVisibleText(`activeFrame=${activeFrame.url()}`) });
  return { activeFrame, persistentOtpToken: none(), urlBeforeSubmit: page.url() };
}

/**
 * Best-effort DOM-ready wait on the active iframe.
 * @param input - Pipeline context (carries the logger handle).
 * @param activeFrame - Frame to wait on.
 * @returns Always `true`.
 */
async function waitFormDomReady(input: IPipelineContext, activeFrame: Page | Frame): Promise<true> {
  const wasReady = await awaitFramePrelude(input, activeFrame, LOGIN_PRE_FRAME_PRELUDE);
  input.logger.debug({ message: `LOGIN PRE: domReady=${String(wasReady)}` });
  return true;
}

/** Bundled resources for {@link runDiscoverFormFlow}. */
interface IDiscoverFormResources {
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly mediator: IElementMediator;
}

/**
 * Build the discovery args bundle from resources + active frame.
 * @param r - Discover-form resources.
 * @param activeFrame - Frame selected by preAction.
 * @returns Field-discovery args bundle.
 */
function buildDiscoverFieldsArgs(
  r: IDiscoverFormResources,
  activeFrame: Page | Frame,
): IDiscoverFieldsArgs {
  const { mediator, config } = r;
  return { mediator, config, activeFrame, page: r.page, logger: r.input.logger };
}

/**
 * Run the field-discovery pass against the resolved active frame.
 * @param r - Discover-form resources.
 * @param activeFrame - Frame selected by preAction.
 * @returns Fully populated login-field discovery.
 */
async function runFieldDiscovery(
  r: IDiscoverFormResources,
  activeFrame: Page | Frame,
): Promise<ILoginFieldDiscovery> {
  const fieldArgs = buildDiscoverFieldsArgs(r, activeFrame);
  return executeDiscoverFields(fieldArgs);
}

/**
 * Commit LOGIN.PRE's state + discovery into the pipeline context.
 * @param input - Pipeline context to extend.
 * @param loginState - Freshly built login state.
 * @param discovery - Result of the field-discovery pass.
 * @returns Success procedure with the extended context.
 */
function commitDiscoverForm(
  input: IPipelineContext,
  loginState: ILoginState,
  discovery: ILoginFieldDiscovery,
): Procedure<IPipelineContext> {
  return succeed({ ...input, login: some(loginState), loginFieldDiscovery: some(discovery) });
}

/**
 * Run the post-preamble half of the discover-form flow.
 * @param r - Discover-form resources.
 * @param activeFrame - Frame selected by preAction.
 * @returns Updated context with login state and field discovery.
 */
async function runPostPreamble(
  r: IDiscoverFormResources,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext>> {
  const loginState = buildLoginState(activeFrame, r.page, r.input.logger);
  await waitFormDomReady(r.input, activeFrame);
  const discovery = await runFieldDiscovery(r, activeFrame);
  return commitDiscoverForm(r.input, loginState, discovery);
}

/**
 * Run the post-gate LOGIN.PRE flow.
 * @param r - Discover-form resources.
 * @returns Updated context with login state and field discovery.
 */
async function runDiscoverFormFlow(
  r: IDiscoverFormResources,
): Promise<Procedure<IPipelineContext>> {
  const neterror = await probeNeterrorAndFail(r.page);
  if (neterror !== false) return neterror;
  const preamble = await runDiscoverFormPreamble(r.config, r.page);
  if (preamble.tag === 'fail') return preamble.proc;
  return runPostPreamble(r, preamble.activeFrame);
}

/**
 * PRE: Discover credential form.
 * @param config - Login config.
 * @param input - Pipeline context with browser.
 * @returns Updated context with login state and field discovery.
 */
async function executeDiscoverForm(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_BROWSER);
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_MEDIATOR);
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  return runDiscoverFormFlow({ config, input, page, mediator });
}

export default executeDiscoverForm;
export { executeDiscoverForm };
