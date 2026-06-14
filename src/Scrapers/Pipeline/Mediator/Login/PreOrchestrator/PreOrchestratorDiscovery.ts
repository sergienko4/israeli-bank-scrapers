/**
 * LOGIN.PRE post-preamble discovery — DOM-ready wait, field discovery,
 * commit to pipeline context.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPreOrchestrator.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { maskVisibleText } from '../../../Types/LogEvent.js';
import { none, some } from '../../../Types/Option.js';
import {
  type ILoginFieldDiscovery,
  type ILoginState,
  type IPipelineContext,
} from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import { awaitFramePrelude } from '../../Elements/PagePrelude.js';
import { executeDiscoverFields, type IDiscoverFieldsArgs } from '../LoginFieldDiscovery.js';
import { type IDiscoverFormResources, LOGIN_PRE_FRAME_PRELUDE } from './PreOrchestratorTypes.js';

export type { IDiscoverFormResources } from './PreOrchestratorTypes.js';

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
export async function runPostPreamble(
  r: IDiscoverFormResources,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext>> {
  const loginState = buildLoginState(activeFrame, r.page, r.input.logger);
  await waitFormDomReady(r.input, activeFrame);
  const discovery = await runFieldDiscovery(r, activeFrame);
  return commitDiscoverForm(r.input, loginState, discovery);
}
