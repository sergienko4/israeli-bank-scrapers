/**
 * Opt-in bounded transient-retry wrapper for the balance dispatch step.
 *
 * Mirrors the 401-only retry in ApiMediator.retry.ts but targets HTTP 429
 * and 5xx responses — transient server-side errors that cause false-red CI
 * when the single /sync call hits a blip. Scoped to the balance step via
 * the opt-in `retryOnTransient` field on IApiDirectScrapeBalanceStep; all
 * other steps (customer, transactions) remain single-shot and byte-identical.
 */

import { createPromise } from '../../Mediator/Timing/TimingActions.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { dispatchStep, type IDispatchArgs } from './ApiDirectScrapeDispatch.js';
import type { ApiBody, ITransientRetryPolicy } from './IApiDirectScrapeShape.js';

/**
 * Cached regex matching HTTP 429 or any 5xx status marker embedded in the
 * failure message. Mirrors STATUS_401_REGEX in ApiMediator.retry.ts — both
 * rely on the `${verb} ${url} ${status}: ${snippet}` format produced by
 * NativeFetchStrategy and CamoufoxIdentityFetchStrategy.
 */
const TRANSIENT_STATUS_REGEX = /\s(?:429|5\d\d):\s/;

/**
 * Decide whether a failed procedure represents a transient server error.
 * Returns false for successful procedures and for 4xx client errors.
 * @param proc - Procedure result to inspect.
 * @returns True iff the failure embeds a 429 or 5xx status marker.
 */
export function isTransientFailure(proc: Procedure<unknown>): boolean {
  if (isOk(proc)) return false;
  return TRANSIENT_STATUS_REGEX.test(proc.errorMessage);
}

/**
 * Bounded backoff wait for transient-retry intervals. Uses
 * createPromise + globalThis.setTimeout to satisfy the anti-sleep
 * and anti-direct-setTimeout ESLint guardrails.
 * @param ms - Delay duration in milliseconds.
 * @returns Promise resolving true after ms.
 */
function waitBackoff(ms: number): Promise<boolean> {
  return createPromise<boolean>((resolve): boolean => {
    globalThis.setTimeout((): boolean => resolve(true), ms);
    return true;
  });
}

/**
 * Decide whether to issue another retry attempt.
 * @param resp - Latest dispatch result.
 * @param attempt - Current zero-based attempt index.
 * @param maxRetries - Ceiling from the retry policy.
 * @returns True iff a retry should follow.
 */
function shouldRetry(resp: Procedure<ApiBody>, attempt: number, maxRetries: number): boolean {
  if (isOk(resp)) return false;
  if (attempt >= maxRetries) return false;
  return isTransientFailure(resp);
}

/**
 * Dispatch with bounded transient-retry backoff. Tail-recursive; stops
 * when `attempt >= policy.maxRetries` or the failure is not transient.
 * @param args - Dispatch args bundle.
 * @param policy - Retry policy (maxRetries + backoffMs).
 * @param attempt - Current attempt index (0-based, default 0).
 * @returns Procedure from the final attempt.
 */
async function dispatchWithTransientRetry(
  args: IDispatchArgs,
  policy: ITransientRetryPolicy,
  attempt = 0,
): Promise<Procedure<ApiBody>> {
  const resp = await dispatchStep(args);
  if (!shouldRetry(resp, attempt, policy.maxRetries)) return resp;
  await waitBackoff(policy.backoffMs);
  return dispatchWithTransientRetry(args, policy, attempt + 1);
}

/**
 * Balance-step dispatch entry point. Routes through transient-retry when
 * the balance shape opts in; otherwise delegates to dispatchStep for
 * byte-identical single-shot behaviour (OneZero, Pepper, any shape that
 * omits retryOnTransient).
 * @param args - Dispatch args built by the caller.
 * @param policy - Shape's balance.retryOnTransient (undefined ⇒ single-shot).
 * @returns Procedure with the balance response body.
 */
export async function dispatchBalanceStep(
  args: IDispatchArgs,
  policy?: ITransientRetryPolicy,
): Promise<Procedure<ApiBody>> {
  if (policy === undefined) return dispatchStep(args);
  return dispatchWithTransientRetry(args, policy);
}
