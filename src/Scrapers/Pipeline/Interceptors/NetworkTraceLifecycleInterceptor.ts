/**
 * NetworkTraceLifecycleInterceptor — gate the live network listener so
 * the discovery pool only contains POST-AUTH traffic. Every browser
 * bank with a declarative login uses it: pre-boundary phases (init,
 * home, pre-login, login, otp-trigger, otp-fill) are silenced; the
 * first phase AFTER the boundary flips collection on. Idempotent —
 * the interceptor calls `setCollectionActive` on every phase entry so
 * a missed activation is auto-corrected next iteration.
 *
 * Black-box rule: phases never touch the lifecycle. The interceptor
 * is the only consumer of `setCollectionActive`.
 */

import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Sentinel returned by `Map.get` when a phase name is unknown. */
const UNKNOWN_INDEX = -1;

/**
 * Build the phase-index lookup once at descriptor build time. The
 * interceptor closes over both the index map and the boundary phase
 * so the per-call check is a single Map.get plus a numeric compare.
 * @param phaseNames - Ordered phase names from the descriptor.
 * @returns Index map.
 */
function buildPhaseIndex(phaseNames: readonly string[]): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < phaseNames.length; i += 1) map.set(phaseNames[i], i);
  return map;
}

/**
 * Build the gate-flip closure invoked from `beforePhase`. Extracted
 * so the interceptor object literal stays under the per-function
 * line budget.
 * @param index - Phase-name -> index map.
 * @param boundaryIdx - Resolved boundary index (or UNKNOWN_INDEX).
 * @returns Closure that flips the gate for a context + next-phase pair.
 */
function buildGateFlipper(
  index: ReadonlyMap<string, number>,
  boundaryIdx: number,
): (ctx: IPipelineContext, nextPhase: string) => Procedure<IPipelineContext> {
  return (ctx: IPipelineContext, nextPhase: string): Procedure<IPipelineContext> => {
    if (!ctx.mediator.has) return succeed(ctx);
    const nextIdx = index.get(nextPhase) ?? UNKNOWN_INDEX;
    const isPostBoundary = nextIdx > boundaryIdx;
    ctx.mediator.value.network.setCollectionActive(isPostBoundary);
    return succeed(ctx);
  };
}

/**
 * Build the `beforePhase` async wrapper around the synchronous gate
 * flipper. Extracted so the interceptor object literal stays inside
 * the per-function line budget.
 * @param flipGate - Synchronous gate-flipper closure.
 * @returns Async beforePhase handler.
 */
function buildBeforePhase(
  flipGate: (ctx: IPipelineContext, nextPhase: string) => Procedure<IPipelineContext>,
): (ctx: IPipelineContext, nextPhase: string) => Promise<Procedure<IPipelineContext>> {
  return (ctx: IPipelineContext, nextPhase: string): Promise<Procedure<IPipelineContext>> => {
    const result = flipGate(ctx, nextPhase);
    return Promise.resolve(result);
  };
}

/**
 * Create the network-trace lifecycle interceptor. Resolves `boundary`
 * at descriptor build time — the first phase whose index is strictly
 * greater than `boundary`'s index activates collection; every earlier
 * phase deactivates it. When `boundary` is unknown (e.g. a bank chain
 * without that phase name) the boundary index is `-1`, so every phase
 * activates collection — preserving legacy behaviour.
 * @param phaseNames - Ordered phase names from `assemblePhases`.
 * @param boundary - Last auth phase name (login | otp-trigger | otp-fill).
 * @returns Pipeline interceptor.
 */
function createNetworkTraceLifecycleInterceptor(
  phaseNames: readonly string[],
  boundary: string,
): IPipelineInterceptor {
  const index = buildPhaseIndex(phaseNames);
  const boundaryIdx = index.get(boundary) ?? UNKNOWN_INDEX;
  const flipGate = buildGateFlipper(index, boundaryIdx);
  const beforePhase = buildBeforePhase(flipGate);
  return { name: 'network-trace-lifecycle', beforePhase };
}

export default createNetworkTraceLifecycleInterceptor;
export { createNetworkTraceLifecycleInterceptor };
