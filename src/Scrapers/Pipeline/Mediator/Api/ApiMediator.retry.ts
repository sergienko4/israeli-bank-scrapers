/**
 * Retry-on-401 orchestration for ApiMediator operations.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import { setRawAuthOp, setSessionWarmOp } from './ApiMediator.state.js';
import type { IMediatorState } from './ApiMediator.types.js';

/** Cached regex matching the embedded HTTP status prefix `<sp>401:<sp>`. */
const STATUS_401_REGEX = /\s401:\s/;

/**
 * Bundled args for `retryOn401Op` (keeps the signature single-line).
 */
interface IRetryOn401Args<T> {
  readonly state: IMediatorState;
  readonly fire: () => Promise<Procedure<T>>;
}

/**
 * Invoke the resolver's `refresh()` with an exception safety net.
 * @param state - Mediator state.
 * @returns Refresh procedure (or a Generic failure when the resolver threw).
 */
async function safeRefreshOp(state: IMediatorState): Promise<Procedure<string>> {
  try {
    return await state.resolver.refresh();
  } catch (error) {
    const message = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `token resolver threw: ${message}`);
  }
}

/**
 * Apply a refreshed Authorization header when present and non-empty.
 * @param state - Mediator state.
 * @param refreshed - Refresh procedure result.
 * @returns True iff the new header was installed and a retry should proceed.
 */
function applyRefreshedAuth(state: IMediatorState, refreshed: Procedure<string>): boolean {
  if (!isOk(refreshed)) return false;
  if (refreshed.value.length === 0) return false;
  setRawAuthOp(state, refreshed.value);
  return true;
}

/**
 * Decide whether the first attempt's failure is a 401 worth retrying.
 * @param first - First-attempt procedure.
 * @returns True iff the failure carries a `401:` status marker.
 */
function isUnauthorizedFailure<T>(first: Procedure<T>): boolean {
  if (first.success) return false;
  return STATUS_401_REGEX.test(first.errorMessage);
}

/**
 * Run a request once, and on a 401 response refresh and retry once.
 *
 * A 401-driven `refresh()` re-mints via a cold path (it spends an OTP), so
 * the session is no longer purely warm — clear `sessionWarm` before the
 * retry so a later degraded scrape does not fire a second recovery OTP.
 * @param args - Bundled mediator-state + fire-callable.
 * @returns Procedure from the first or second attempt.
 */
async function retryOn401Op<T>(args: IRetryOn401Args<T>): Promise<Procedure<T>> {
  const first = await args.fire();
  if (!isUnauthorizedFailure(first)) return first;
  const refreshed = await safeRefreshOp(args.state);
  const isReady = applyRefreshedAuth(args.state, refreshed);
  if (!isReady) return first;
  setSessionWarmOp(args.state, false);
  return args.fire();
}

/**
 * Fire the post-recovery re-cache hook with the freshly minted header.
 *
 * The hook (installed by the ACTION phase) re-installs the new carry/session
 * context onto the bus and re-surfaces the new long-term token to the caller's
 * `onAuthFlowComplete` so a server-degraded-but-locally-fresh token is
 * re-cached to disk and reused next run instead of re-OTP'ing every time.
 * @param state - Mediator state.
 * @param refreshed - Successful refresh procedure carrying the new header.
 * @returns True once the hook ran (false when absent or refresh failed).
 */
async function runRecoveredHook(
  state: IMediatorState,
  refreshed: Procedure<string>,
): Promise<boolean> {
  if (!isOk(refreshed)) return false;
  if (state.onRecovered === undefined) return false;
  await state.onRecovered(refreshed.value);
  return true;
}

/**
 * Discard the stale bearer when a recovery refresh fails (defense-in-depth).
 * @param state - Mediator state.
 * @param refreshed - The failed refresh procedure (propagated unchanged).
 * @returns The same failed procedure so the caller fails loud.
 */
function discardOnFailedRecovery(
  state: IMediatorState,
  refreshed: Procedure<string>,
): Procedure<string> {
  setRawAuthOp(state, '');
  return refreshed;
}

/**
 * Discard the current (degraded) session and re-mint via a full cold flow.
 *
 * Reuses the proven recovery primitives: {@link safeRefreshOp} runs the
 * resolver's cold `refresh()` and {@link applyRefreshedAuth} installs the new
 * Authorization header on success. The session is flipped cold
 * (`sessionWarm=false`) on BOTH success and failure (recover-once). On success
 * the re-cache hook re-installs session context + re-surfaces the new token; on
 * failure the stale bearer is cleared and the failure propagates so the caller
 * fails loud instead of masking degradation.
 * @param state - Mediator state.
 * @returns Refresh procedure (success carries the fresh header value).
 */
async function recoverSessionOp(state: IMediatorState): Promise<Procedure<string>> {
  const refreshed = await safeRefreshOp(state);
  const isReady = applyRefreshedAuth(state, refreshed);
  setSessionWarmOp(state, false);
  if (!isReady) return discardOnFailedRecovery(state, refreshed);
  await runRecoveredHook(state, refreshed);
  return refreshed;
}

export { recoverSessionOp, retryOn401Op, safeRefreshOp };
export type { IRetryOn401Args };
