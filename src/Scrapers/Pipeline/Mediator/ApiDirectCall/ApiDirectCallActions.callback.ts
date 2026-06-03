/**
 * Auth-flow completion callback dispatcher for the ApiDirectCall ACTION stage.
 * Catches user-callback throws so scrape success isn't invalidated by them.
 */

import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { isSome, none, type Option, some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { type IAuthFlowCallback, PHASE_LABEL } from './ApiDirectCallActions.shared.js';
import type { IConfigTokenStrategy } from './Flow/TokenStrategyFromConfig.js';

/** Auth-flow callback payload. */
interface IAuthFlowPayload {
  readonly longTermToken: string;
  readonly bearer: string;
}

/** Bundle resolved before {@link runAuthFlowCallback} fires. */
interface IInvocationBundle {
  readonly callback: IAuthFlowCallback;
  readonly payload: IAuthFlowPayload;
}

/**
 * Log a callback throw without raising it.
 * @param ctx - Pipeline context (for logger).
 * @param error - Thrown error.
 * @returns false sentinel for caller propagation.
 */
function logCallbackThrow(ctx: IPipelineContext, error: unknown): boolean {
  const message = toErrorMessage(error as Error);
  ctx.logger.warn({ message: `${PHASE_LABEL} onAuthFlowComplete callback threw: ${message}` });
  return false;
}

/** Args for {@link runAuthFlowCallback}. */
interface IRunCallbackArgs {
  readonly ctx: IPipelineContext;
  readonly bundle: IInvocationBundle;
}

/**
 * Run the configured auth-flow callback with catch+log.
 * @param args - Pipeline context plus callback bundle.
 * @returns true on success, false on callback throw.
 */
async function runAuthFlowCallback(args: IRunCallbackArgs): Promise<boolean> {
  try {
    await args.bundle.callback(args.bundle.payload);
    return true;
  } catch (error) {
    return logCallbackThrow(args.ctx, error);
  }
}

/**
 * Pick the user callback off ctx.options as an Option.
 * @param ctx - Pipeline context.
 * @returns Some(callback) when configured, none() otherwise.
 */
function pickAuthCallback(ctx: IPipelineContext): Option<IAuthFlowCallback> {
  const opts = ctx.options as { onAuthFlowComplete?: IAuthFlowCallback };
  if (opts.onAuthFlowComplete === undefined) return none();
  return some(opts.onAuthFlowComplete);
}

/** Args for {@link pickInvocationBundle}. */
interface IInvocationLookupArgs {
  readonly ctx: IPipelineContext;
  readonly strategy: IConfigTokenStrategy;
  readonly bearer: string;
}

/**
 * Assemble the invocation bundle when both callback and long-term token exist.
 * @param args - Pipeline context, strategy, and bearer header.
 * @returns Some(bundle) when invocation is warranted, none() otherwise.
 */
function pickInvocationBundle(args: IInvocationLookupArgs): Option<IInvocationBundle> {
  const callbackOpt = pickAuthCallback(args.ctx);
  if (!isSome(callbackOpt)) return none();
  const longTermToken = args.strategy.getLatestLongTermToken();
  if (longTermToken.length === 0) return none();
  const payload: IAuthFlowPayload = { longTermToken, bearer: args.bearer };
  return some({ callback: callbackOpt.value, payload });
}

/**
 * Invoke ctx.options.onAuthFlowComplete when a long-term token exists.
 * @param ctx - Pipeline context.
 * @param strategy - Config-driven token strategy.
 * @param bearer - Authorization header value installed on the bus.
 * @returns true when the callback ran successfully.
 */
async function invokeAuthFlowComplete(
  ctx: IPipelineContext,
  strategy: IConfigTokenStrategy,
  bearer: string,
): Promise<boolean> {
  const bundleOpt = pickInvocationBundle({ ctx, strategy, bearer });
  if (!isSome(bundleOpt)) return false;
  return runAuthFlowCallback({ ctx, bundle: bundleOpt.value });
}

export default invokeAuthFlowComplete;

export { invokeAuthFlowComplete };
