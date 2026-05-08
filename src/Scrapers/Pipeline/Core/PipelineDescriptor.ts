/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';

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
  readonly isHeadless?: boolean;
  /**
   * Boundary phase after which the network interceptor starts
   * collecting captures. Phase 7 placed it BEFORE the auth phase
   * (`pre-login` when configured, otherwise `home`) so the discovery
   * pool admits id-bearing captures fired during `login.*` substeps.
   * Absent/empty for headless or test pipelines that don't gate the
   * network. Carried for diagnostics only — the actual gating is
   * owned by `NetworkTraceLifecycleInterceptor`.
   */
  readonly traceStartAfterPhase?: string;
}

export default IPipelineDescriptor;
export type { IPipelineDescriptor };
