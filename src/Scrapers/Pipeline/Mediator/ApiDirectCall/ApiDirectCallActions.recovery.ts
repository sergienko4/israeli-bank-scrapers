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
import type { IConfigTokenStrategy } from './Flow/TokenStrategyFromConfig.js';

/** Collaborators captured by {@link makeRecoveryHook}. */
interface IRecoveryHookArgs {
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly strategy: IConfigTokenStrategy;
}

/**
 * Build the recovery hook that re-installs context + re-caches the new token.
 * @param args - Bus + context + strategy bundle.
 * @returns Hook fired by the mediator after a successful cold recovery.
 */
function makeRecoveryHook(args: IRecoveryHookArgs): RecoveredHook {
  const { bus, ctx, strategy } = args;
  return async (header: string): Promise<void> => {
    const snapshot = strategy.getLatestCarrySnapshot();
    bus.setSessionContext(snapshot);
    await invokeAuthFlowComplete(ctx, strategy, header);
  };
}

export default makeRecoveryHook;

export { makeRecoveryHook };
