/**
 * Pipeline Interceptor — middleware that runs between phases.
 * Cross-cutting concerns (popup dismissal, cookie consent, loading waits)
 * live here instead of inside phase PRE steps.
 *
 * SOLID: SRP (phases do one thing), OCP (add interceptors without touching phases).
 * Result Pattern: returns Procedure<IPipelineContext> — never throws.
 */

import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';

/** Middleware that runs between pipeline phases. */
interface IPipelineInterceptor {
  /** Human-readable name for diagnostics. */
  readonly name: string;
  /**
   * Run before the next phase starts.
   * Receives accumulated context, returns updated context or failure.
   * @param ctx - Current pipeline context.
   * @returns Updated context or failure.
   */
  beforePhase(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>>;
}

export default IPipelineInterceptor;
export type { IPipelineInterceptor };
