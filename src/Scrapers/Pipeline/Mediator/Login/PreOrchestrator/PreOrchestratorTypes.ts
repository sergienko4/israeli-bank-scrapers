/**
 * Shared types + constants for LOGIN.PRE orchestration.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPreOrchestrator.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import type { IPreludeSpec } from '../../Elements/PagePrelude.js';
import { ELEMENTS_DOM_READY_TIMEOUT_MS } from '../../Timing/TimingConfig.js';

/** Failure message for the LOGIN PRE missing-browser early gate. */
export const LOGIN_PRE_NO_BROWSER = 'LOGIN PRE: no browser';

/** Failure message for the LOGIN PRE missing-mediator early gate. */
export const LOGIN_PRE_NO_MEDIATOR = 'LOGIN PRE: no mediator';

/** LOGIN.PRE prelude spec — DOM-ready ceiling for the iframe-hosted login form. */
export const LOGIN_PRE_FRAME_PRELUDE: IPreludeSpec = {
  level: 'dom',
  timeoutMs: ELEMENTS_DOM_READY_TIMEOUT_MS,
};

/** Outcome of running the LOGIN.PRE checkReadiness + preAction preamble. */
export type DiscoverFormPreamble =
  | { readonly tag: 'fail'; readonly proc: Procedure<IPipelineContext> }
  | { readonly tag: 'frame'; readonly activeFrame: Page | Frame };

/** Bundled resources for the LOGIN.PRE discover-form flow. */
export interface IDiscoverFormResources {
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly mediator: IElementMediator;
}
