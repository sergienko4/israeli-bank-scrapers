/**
 * LOGIN field-discovery shared types — extracted into a sibling file
 * so {@link ./LoginSubmitResolve.ts} can consume {@link IDiscoverFieldsArgs}
 * without importing from {@link ./LoginFieldDiscovery.ts} (which itself
 * imports `resolveSubmitTarget` from `LoginSubmitResolve.ts`).
 *
 * <p>This split closes the type-only import cycle introduced by the
 * Phase 2d strict-mode lockdown without weakening the public-surface
 * shape (consumers can still import the type from `LoginFieldDiscovery.ts`
 * via the re-export there).
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Bundled arguments for discovering all login fields. */
export interface IDiscoverFieldsArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly activeFrame: Page | Frame;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}
