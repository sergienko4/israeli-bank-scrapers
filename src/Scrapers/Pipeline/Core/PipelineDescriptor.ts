/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';

/** Headless-mode flag — true when the bank uses API-only transport. */
type IsHeadless = boolean;

/** Descriptor produced by PipelineBuilder, consumed by PipelineExecutor. */
interface IPipelineDescriptor {
  readonly options: ScraperOptions;
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
  /**
   * Headless flag — when true, the executor wires an ApiMediator
   * instead of the default HTML-first mediator. API-native banks set
   * this via `PipelineBuilder.withHeadlessMediator()`. Absent/false
   * for browser-driven banks (back-compat).
   */
  readonly isHeadless?: IsHeadless;
}

export default IPipelineDescriptor;
export type { IPipelineDescriptor };
