/**
 * Pipeline-specific login config — extends ILoginConfig with pipeline context access.
 * Needed for multi-stage login flows (e.g., Max conditional ID form)
 * where postAction needs credentials from IPipelineContext.
 *
 * No circular dependency: Pipeline → Base (ILoginConfig) is fine.
 * Base never imports from Pipeline.
 */

import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from './PipelineContext.js';

/**
 * Extended login config with pipeline context access for post-action.
 * Banks that need credentials in postAction (multi-stage login) use this.
 * Banks with simple login use plain ILoginConfig — fully backward-compatible.
 */
interface IPipelineLoginConfig extends ILoginConfig {
  /**
   * Post-action with pipeline context — for multi-stage login flows.
   * Called instead of postAction when present. Receives full context (credentials, mediator, etc.).
   * @param page - Browser page.
   * @param ctx - Full pipeline context with credentials and mediator.
   */
  readonly postActionWithCtx?: (page: Page, ctx: IPipelineContext) => Promise<boolean>;
}

/**
 * Type guard: check if a login config has pipeline-aware postAction.
 * @param config - The login config to check.
 * @returns True if config has postActionWithCtx.
 */
function hasPipelinePostAction(config: ILoginConfig): config is IPipelineLoginConfig {
  const extended = config as IPipelineLoginConfig;
  return 'postActionWithCtx' in config && typeof extended.postActionWithCtx === 'function';
}

export type { IPipelineLoginConfig };
export { hasPipelinePostAction };
