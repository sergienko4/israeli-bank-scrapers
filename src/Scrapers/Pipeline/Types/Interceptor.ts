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

/** Human-readable label for diagnostics logging. */
type DiagnosticLabel = string;

/** Result of an afterPipeline hook — true on success, false on no-op/failure. */
type FinalizeResult = boolean;

/** Middleware that runs between pipeline phases. */
interface IPipelineInterceptor {
  /** Human-readable name for diagnostics. */
  readonly name: DiagnosticLabel;
  /**
   * Run before the next phase starts.
   * Receives accumulated context, returns updated context or failure.
   * @param ctx - Current pipeline context.
   * @param nextPhase - Name of the phase about to run.
   * @returns Updated context or failure.
   */
  beforePhase(ctx: IPipelineContext, nextPhase: string): Promise<Procedure<IPipelineContext>>;
  /**
   * Optional hook — runs once after the final phase, before browser cleanup.
   * Used by SnapshotInterceptor to capture the terminal DOM state (which
   * beforePhase cannot reach because no phase follows it). Best-effort: a
   * failure here must not prevent cleanup.
   * @param ctx - Last accumulated pipeline context.
   * @returns Finalization outcome wrapped in a Procedure.
   */
  afterPipeline?(ctx: IPipelineContext): Promise<Procedure<FinalizeResult>>;
}

export default IPipelineInterceptor;
export type { IPipelineInterceptor };
