/**
 * SnapshotInterceptor — capture DOM snapshots between phases.
 *
 * Activation: process.env.DUMP_SNAPSHOTS === '1' (checked at interceptor creation).
 * Effect: before each phase, writes the current `page.content()` to
 *   tests/snapshots/{companyId}/{previousPhase}.html
 *
 * Purpose: build a local corpus of real DOM state after each phase so
 * MockInterceptor can replay them offline. Best-effort: failures never
 * break the pipeline — a missed snapshot is not a scrape failure.
 *
 * IO helpers live in SnapshotInterceptorIO.ts to keep this file under the
 * 150-line Pipeline limit.
 */

import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { PhaseName } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import { captureSnapshot } from './SnapshotInterceptorIO.js';

/** Finalization outcome — true once the last snapshot has been attempted. */
type FinalizeResult = boolean;

/** Env flag name that activates snapshotting. */
const ENV_FLAG = 'DUMP_SNAPSHOTS';

/** Phase name remembered across beforePhase calls. */
type SeenPhase = string;

/** Mutable state for a snapshot interceptor instance. */
interface ISnapshotState {
  /** Last phase we saw in beforePhase — used only by the finalizer fallback. */
  lastSeenPhase: SeenPhase;
}

/**
 * Check whether snapshot capture is enabled via env var.
 * @returns True when DUMP_SNAPSHOTS is set to a truthy value.
 */
function isSnapshotEnabled(): FinalizeResult {
  const val = process.env[ENV_FLAG];
  return val === '1' || val === 'true';
}

/**
 * beforePhase pass-through for the disabled interceptor.
 * @param ctx - Current pipeline context.
 * @returns The same context, unchanged.
 */
function passThroughPhase(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const result = succeed(ctx);
  return Promise.resolve(result);
}

/**
 * Build a no-op interceptor used when DUMP_SNAPSHOTS is unset.
 * @returns Inert interceptor that passes context through unchanged.
 */
function buildNoopInterceptor(): IPipelineInterceptor {
  return { name: 'SnapshotInterceptor(disabled)', beforePhase: passThroughPhase };
}

/**
 * Build the beforePhase handler for the active snapshot interceptor.
 * Captures the DOM at the ENTRY of each phase — so home.html is what
 * HOME.pre sees (the landing page), not the post-HOME state (login form).
 * Rule #20 compliance: PRE gets real snapshots to validate its selectors.
 * @param state - Mutable per-run state.
 * @returns beforePhase function.
 */
function buildActiveHandler(
  state: ISnapshotState,
): (ctx: IPipelineContext, nextPhase: PhaseName) => Promise<Procedure<IPipelineContext>> {
  return async (ctx, nextPhase): Promise<Procedure<IPipelineContext>> => {
    await captureSnapshot(ctx, nextPhase);
    state.lastSeenPhase = nextPhase;
    return succeed(ctx);
  };
}

/**
 * Build the afterPipeline finalizer — captures a 'final' DOM snapshot after
 * the last phase completes. In a success run this is the post-TERMINATE
 * state; in a failure run it's the DOM at the moment of failure. Useful for
 * debugging real-run issues without re-running.
 * @param state - Mutable per-run state.
 * @returns Finalizer function.
 */
function buildFinalizer(
  state: ISnapshotState,
): (ctx: IPipelineContext) => Promise<Procedure<FinalizeResult>> {
  return async (ctx): Promise<Procedure<FinalizeResult>> => {
    if (!state.lastSeenPhase) return succeed(false);
    await captureSnapshot(ctx, 'final');
    return succeed(true);
  };
}

/**
 * Build the active snapshot interceptor with mutable per-run state.
 * @returns Stateful interceptor that writes snapshots on phase transitions.
 */
function buildActiveInterceptor(): IPipelineInterceptor {
  const state: ISnapshotState = { lastSeenPhase: '' };
  return {
    name: 'SnapshotInterceptor',
    beforePhase: buildActiveHandler(state),
    afterPipeline: buildFinalizer(state),
  };
}

/**
 * Build the snapshot interceptor. Returns an inert interceptor when
 * DUMP_SNAPSHOTS is unset so the caller never has to check for absence.
 * @returns Interceptor instance (active or no-op).
 */
function createSnapshotInterceptor(): IPipelineInterceptor {
  if (!isSnapshotEnabled()) return buildNoopInterceptor();
  return buildActiveInterceptor();
}

export { createSnapshotInterceptor, isSnapshotEnabled };
