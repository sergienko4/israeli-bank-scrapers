/**
 * Retry-on-auth-rejection orchestration for ApiMediator operations.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import { isAuthRejectionMessage } from './ApiMediator.authReject.js';
import { getSessionWarmOp, setRawAuthOp, setSessionWarmOp } from './ApiMediator.state.js';
import type { IMediatorState } from './ApiMediator.types.js';

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
 * Build the failure returned when a refresh is requested while one is running.
 * @returns Generic failure describing the blocked re-entrant refresh.
 */
function refreshBusyFailure(): Procedure<string> {
  return fail(ScraperErrorTypes.Generic, 'refresh already in progress (re-entrancy guard)');
}

/**
 * Run a refresh under a re-entrancy guard so a re-mint can never trigger a
 * nested re-mint.
 *
 * A cold `refresh()` replays the bank's login flow, whose first step calls back
 * into `apiPost` on the SAME mediator. If that replay also fails with an auth
 * marker it would request another refresh — the exact mutual recursion that
 * fired 7177 requests at a blocking edge and never unwound. While a refresh is
 * in flight the flag short-circuits any nested attempt with a plain failure, so
 * the caller fails loud instead of recursing.
 * @param state - Mediator state.
 * @returns Refresh procedure, or a Generic failure when one is already running.
 */
async function guardedRefreshOp(state: IMediatorState): Promise<Procedure<string>> {
  if (state.isRefreshing) return refreshBusyFailure();
  state.isRefreshing = true;
  try {
    return await safeRefreshOp(state);
  } finally {
    state.isRefreshing = false;
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
 * Decide whether the first attempt's failure is worth a token re-mint.
 *
 * A Cloudflare WAF block answers with a 403 page whose message carries the same
 * `<sp>403:<sp>` marker a stale bearer does, but the edge rejected the request
 * BEFORE the API saw it — re-minting cannot help and only feeds an unbounded
 * retry storm. A `WafBlocked` failure is therefore terminal.
 * @param first - First-attempt procedure.
 * @returns True iff the failure is a genuine auth rejection (never a WAF block).
 */
function isUnauthorizedFailure<T>(first: Procedure<T>): boolean {
  if (first.success) return false;
  if (first.errorType === ScraperErrorTypes.WafBlocked) return false;
  return isAuthRejectionMessage(first.errorMessage);
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
 * @param wasWarm - Session warmth captured before recovery flipped it cold.
 * @returns True once the hook ran (false when absent or refresh failed).
 */
async function runRecoveredHook(
  state: IMediatorState,
  refreshed: Procedure<string>,
  wasWarm: boolean,
): Promise<boolean> {
  if (!isOk(refreshed)) return false;
  if (state.onRecovered === undefined) return false;
  await state.onRecovered(refreshed.value, wasWarm);
  return true;
}

/**
 * Re-mint the bearer after an auth rejection and re-arm the session.
 *
 * Warmth is read *before* the cold flip so the re-cache hook can still tell a
 * degraded warm session from one that was already cold. On success the new
 * header is installed, the session is flipped cold (recover-once) and the hook
 * fires, which is what carries the fresh long-term token out to
 * `onAuthFlowComplete` instead of letting it die in memory.
 * @param state - Mediator state.
 * @returns True when a fresh bearer is installed and the retry may proceed.
 */
async function rearmAfterAuthRejection(state: IMediatorState): Promise<boolean> {
  const wasWarm = getSessionWarmOp(state);
  const refreshed = await guardedRefreshOp(state);
  const isReady = applyRefreshedAuth(state, refreshed);
  if (!isReady) return false;
  setSessionWarmOp(state, false);
  await runRecoveredHook(state, refreshed, wasWarm);
  return true;
}

/**
 * Run a request once, and on an auth rejection refresh and retry once.
 *
 * <p>This is the *mainline* recovery path: every `apiPost`/`apiGet`/`apiQuery`
 * funnels through here, so it — not the explicit `recoverSession` — is where a
 * mid-scrape re-mint usually happens. It therefore fires the same
 * {@link runRecoveredHook} `recoverSession` fires: without that, the new
 * long-term token would live only in memory, the caller's cache would keep the
 * dead one, and the next run would spend another SMS OTP replaying it.
 * Re-arming happens *before* the retry so the retried attempt is signed
 * with the session context the refresh just minted rather than the dead one.
 * @param args - Bundled mediator-state + fire-callable.
 * @returns Procedure from the first or second attempt.
 */
async function retryOn401Op<T>(args: IRetryOn401Args<T>): Promise<Procedure<T>> {
  const first = await args.fire();
  if (!isUnauthorizedFailure(first)) return first;
  const isRearmed = await rearmAfterAuthRejection(args.state);
  if (!isRearmed) return first;
  return args.fire();
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
 * fails loud instead of masking degradation. The pre-flip warmth is handed to
 * the hook, which could not otherwise observe it.
 * @param state - Mediator state.
 * @returns Refresh procedure (success carries the fresh header value).
 */
async function recoverSessionOp(state: IMediatorState): Promise<Procedure<string>> {
  const wasWarm = getSessionWarmOp(state);
  const refreshed = await guardedRefreshOp(state);
  const isReady = applyRefreshedAuth(state, refreshed);
  setSessionWarmOp(state, false);
  if (!isReady) return discardOnFailedRecovery(state, refreshed);
  await runRecoveredHook(state, refreshed, wasWarm);
  return refreshed;
}

export { recoverSessionOp, retryOn401Op, safeRefreshOp };
export type { IRetryOn401Args };
