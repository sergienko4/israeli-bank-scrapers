/**
 * Builds the post-recovery re-cache hook for the ApiDirectCall ACTION stage.
 *
 * The Api cluster must not import ApiDirectCall, so the hook is constructed
 * here (in the ACTION phase) and installed onto the mediator via
 * `bus.withRecoveryHook`. On a successful recovery the hook re-installs
 * the new carry snapshot, projected through the flow's `sessionCarry`
 * allowlist, as the session context, and re-surfaces the new long-term
 * token to `onAuthFlowComplete` — closing the gap where a re-minted token was
 * discarded from the cache, forcing a fresh OTP every run. A recovery that
 * resumed the session is noted once instead of being called degraded.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IApiMediator, RecoveredHook } from '../Api/ApiMediator.js';
import { invokeAuthFlowComplete } from './ApiDirectCallActions.callback.js';
import { COLD_FALLBACK_DEGRADED, PHASE_LABEL } from './ApiDirectCallActions.shared.js';
import type { IConfigTokenStrategy } from './Flow/Lifecycle/TokenStrategyFromConfig.js';
import { projectSessionCarry } from './SessionCarryProjection.js';

/** Collaborators captured by {@link makeRecoveryHook}. */
interface IRecoveryHookArgs {
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly strategy: IConfigTokenStrategy;
  /** The flow's fallback clause, from `coldFallbackDetail`. */
  readonly fallbackDetail: string;
  /** The flow's `sessionCarry` allowlist; absent installs the full snapshot. */
  readonly sessionCarry?: readonly string[];
}

/**
 * Warn when a warm session was the thing that just died.
 *
 * <p>The initial prime already warns when a stored token fails to carry a
 * session. A token can also pass the local freshness check, carry the
 * session, and then be rejected by the bank mid-run — revoked server-side,
 * or expired against a claim we do not read. Recovery silently runs the full
 * login again to repair that (an SMS, for a flow that asks for a code), so
 * without this line the degradation is invisible exactly where it is most
 * surprising.
 *
 * <p>The verdict is the one the mediator captured before it flipped the
 * session cold; asking the bus here would always read `false`.
 * @param args - Bus + context + strategy bundle.
 * @param wasWarm - Session warmth before recovery flipped it cold.
 * @returns True when the warning was emitted.
 */
function warnOnRecoveredWarmSession(args: IRecoveryHookArgs, wasWarm: boolean): boolean {
  if (!wasWarm) return false;
  const detail = `${COLD_FALLBACK_DEGRADED}; ${args.fallbackDetail}`;
  args.ctx.logger.warn({ message: `${PHASE_LABEL} ${detail}` });
  return true;
}

/** Info line for a recovery that resumed the session rather than logging in. */
const REGRANTED_NOTE = 're-granted the session token';

/**
 * Tell the truth about the recovery: a resumed session is noted once;
 * only a cold one falls to the degraded-session rule. A strategy without
 * `lastRecoveryResumed` keeps that rule alone.
 * @param args - Bus + context + strategy bundle.
 * @param wasWarm - Session warmth before recovery flipped it cold.
 * @returns True when the degraded warning was emitted.
 */
function reportRecovery(args: IRecoveryHookArgs, wasWarm: boolean): boolean {
  const isResumed = args.strategy.lastRecoveryResumed?.() ?? false;
  if (!isResumed) return warnOnRecoveredWarmSession(args, wasWarm);
  args.ctx.logger.info({ message: `${PHASE_LABEL} ${REGRANTED_NOTE}` });
  return false;
}

/**
 * Build the recovery hook that re-installs context + re-caches the new token.
 * @param args - Bus + context + strategy + allowlist bundle.
 * @returns Hook fired by the mediator after a successful recovery.
 */
function makeRecoveryHook(args: IRecoveryHookArgs): RecoveredHook {
  const { bus, ctx, strategy, sessionCarry } = args;
  return async (header: string, wasWarm: boolean): Promise<void> => {
    reportRecovery(args, wasWarm);
    const snapshot = strategy.getLatestCarrySnapshot();
    const session = projectSessionCarry(snapshot, sessionCarry);
    bus.setSessionContext(session);
    await invokeAuthFlowComplete(ctx, strategy, header);
  };
}

export default makeRecoveryHook;

export { makeRecoveryHook };
