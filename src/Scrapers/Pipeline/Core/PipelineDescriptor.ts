/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { Procedure } from '../Types/Procedure.js';

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

/**
 * Factory that builds a pipeline descriptor for a specific bank.
 *
 * <p>OCP: this is the only pipeline-registry contract Core declares — it knows
 * NOTHING about concrete banks. The bank -> factory map lives in the Banks
 * layer (`Banks/PipelineRegistry.ts`), so adding a bank touches only
 * `Banks/**`. The `CoreBankIndependence` architecture test enforces that Core
 * carries zero imports of `Banks/**`.
 */
type PipelineFactory = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

export default IPipelineDescriptor;
export type { IPipelineDescriptor, PipelineFactory };
