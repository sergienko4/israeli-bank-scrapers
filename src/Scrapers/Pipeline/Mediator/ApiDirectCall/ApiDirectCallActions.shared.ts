/**
 * Shared constants + helpers for the ApiDirectCallActions cluster:
 * phase label, safeInvoke wrapper, and the IAuthFlowCallback alias.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IAuthFlowInfo } from '../../../Base/Interface.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** Diagnostic label for the phase — appears in error messages. */
const PHASE_LABEL = 'api-direct-call';

/**
 * The clause emitted by every warm-start fallback — the fact an operator
 * actually acts on: this run spent an SMS it was meant to avoid.
 *
 * <p>Shared so one grep still finds both places a warm session can degrade.
 * The *cause* is not shared, because the two are not the same event: a token
 * that carried a session and was revoked later was very much "accepted", and
 * saying otherwise sends the reader hunting a bad stored token that was in
 * fact fine. Each call site prefixes its own cause.
 */
const COLD_FALLBACK_DETAIL = 'fell back to the full SMS login';

/**
 * Cause named when the bank refused the stored token at the initial prime.
 *
 * <p>Reserved for an actual server refusal. A token the local freshness gate
 * threw out never reached the bank, so reporting it this way would send an
 * operator digging through identity-server logs for a request that was never
 * made — see {@link COLD_FALLBACK_STALE}.
 */
const COLD_FALLBACK_REJECTED = 'stored long-term token was not accepted';

/**
 * Cause named when the stored token failed the local freshness gate and was
 * therefore never sent. The remedy is on this side — the stored copy is
 * expired or malformed — not at the bank.
 */
const COLD_FALLBACK_STALE = 'stored long-term token failed the local freshness check';

/** Cause named when a session that had been carrying fine died mid-run. */
const COLD_FALLBACK_DEGRADED = 'warm session was rejected mid-run';

/** ScraperOptions callback signature — surfaced at the bank surface. */
type IAuthFlowCallback = (info: IAuthFlowInfo) => void | Promise<void>;

/**
 * Build a Procedure failure for an exception thrown by `safeInvoke`.
 * @param label - Short context for the error.
 * @param error - Captured exception.
 * @returns Procedure failure wrapping the thrown error.
 */
function buildThrowFailure<T>(label: string, error: unknown): Procedure<T> {
  const message = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ${label} threw: ${message}`);
}

/**
 * Convert thrown errors into Procedure failures — same shape as the
 * plugin-based safeInvoke.
 * @param label - Short context for error diagnostics.
 * @param fn - Async function to invoke.
 * @returns Procedure resolved from the call.
 */
async function safeInvoke<T>(
  label: string,
  fn: () => Promise<Procedure<T>>,
): Promise<Procedure<T>> {
  try {
    return await fn();
  } catch (error) {
    return buildThrowFailure<T>(label, error);
  }
}

export {
  COLD_FALLBACK_DEGRADED,
  COLD_FALLBACK_DETAIL,
  COLD_FALLBACK_REJECTED,
  COLD_FALLBACK_STALE,
  PHASE_LABEL,
  safeInvoke,
};
export type { IAuthFlowCallback };
