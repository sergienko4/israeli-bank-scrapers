/**
 * Builds the post-recovery re-cache hook for the ApiDirectCall ACTION stage.
 *
 * The Api cluster must not import ApiDirectCall, so the hook is constructed
 * here (in the ACTION phase) and installed onto the mediator via
 * `bus.withRecoveryHook`. On a successful cold recovery the hook re-installs
 * the new carry/session-context snapshot and re-surfaces the new long-term
 * token to `onAuthFlowComplete` — closing the gap where a re-minted token was
 * discarded from the cache, forcing a fresh OTP every run.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IApiMediator, RecoveredHook } from '../Api/ApiMediator.js';
import { invokeAuthFlowComplete } from './ApiDirectCallActions.callback.js';
import { COLD_FALLBACK_DETAIL, PHASE_LABEL } from './ApiDirectCallActions.shared.js';
import type { IConfigTokenStrategy } from './Flow/TokenStrategyFromConfig.js';

/** Collaborators captured by {@link makeRecoveryHook}. */
interface IRecoveryHookArgs {
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly strategy: IConfigTokenStrategy;
}

/**
 * Warn when a warm session was the thing that just died.
 *
 * <p>The initial prime already warns when a stored token fails to carry a
 * session. A token can also pass the local freshness check, carry the
 * session, and then be rejected by the bank mid-run — revoked server-side,
 * or expired against a claim we do not read. Recovery silently spends an
 * SMS to repair that, so without this line the degradation is invisible
 * exactly where it is most surprising.
 *
 * <p>The verdict is the one the mediator captured before it flipped the
 * session cold; asking the bus here would always read `false`.
 * @param args - Bus + context + strategy bundle.
 * @param wasWarm - Session warmth before recovery flipped it cold.
 * @returns True when the warning was emitted.
 */
function warnOnRecoveredWarmSession(args: IRecoveryHookArgs, wasWarm: boolean): boolean {
  if (!wasWarm) return false;
  args.ctx.logger.warn({ message: `${PHASE_LABEL} ${COLD_FALLBACK_DETAIL}` });
  return true;
}

/**
 * Build the recovery hook that re-installs context + re-caches the new token.
 * @param args - Bus + context + strategy bundle.
 * @returns Hook fired by the mediator after a successful cold recovery.
 */
function makeRecoveryHook(args: IRecoveryHookArgs): RecoveredHook {
  const { bus, ctx, strategy } = args;
  return async (header: string, wasWarm: boolean): Promise<void> => {
    warnOnRecoveredWarmSession(args, wasWarm);
    const snapshot = strategy.getLatestCarrySnapshot();
    bus.setSessionContext(snapshot);
    await invokeAuthFlowComplete(ctx, strategy, header);
  };
}

export default makeRecoveryHook;

export { makeRecoveryHook };
