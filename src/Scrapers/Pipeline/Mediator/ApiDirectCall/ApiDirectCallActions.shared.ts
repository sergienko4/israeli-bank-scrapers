/**
 * Shared constants + helpers for the ApiDirectCallActions cluster:
 * phase label, safeInvoke wrapper, and the IAuthFlowCallback alias.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IAuthFlowInfo } from '../../../Base/Interface.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';

/** Diagnostic label for the phase — appears in error messages. */
const PHASE_LABEL = 'api-direct-call';

/** Which cold login a flow falls back to: one that sends a code, or one that does not. */
type ColdLoginKind = 'otp' | 'password';

/** The creds field a step's `preHook` awaits when it waits for a one-time code. */
const OTP_CREDS_FIELD = 'otpCodeRetriever';

/**
 * The clause emitted by every warm-start fallback — the fact an operator
 * actually acts on: this run paid for the full login it was meant to avoid.
 * For a flow that asks for a code that cost is an SMS, and the clause says so;
 * a flow that never asks for one must not claim it did.
 *
 * <p>Shared so one grep still finds both places a warm session can degrade.
 * The *cause* is not shared, because the two are not the same event: a token
 * that carried a session and was revoked later was very much "accepted", and
 * saying otherwise sends the reader hunting a bad stored token that was in
 * fact fine. Each call site prefixes its own cause.
 */
const COLD_FALLBACK_DETAIL: Readonly<Record<ColdLoginKind, string>> = {
  otp: 'fell back to the full SMS login',
  password: 'fell back to the full cold login',
};

/**
 * Cause named when a warm attempt was made and did not carry the session.
 *
 * <p>Deliberately neutral. The cold retry fires on any warm failure except a
 * WAF block — a bank refusal, a timeout, a transport error — and those are not
 * distinguishable from the warm flag alone. Naming one of them would be a
 * guess, so the warm attempt's own failure is appended instead.
 */
const COLD_FALLBACK_WARM_FAILED = 'warm start with the stored long-term token did not succeed';

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

/**
 * Pick the fallback clause for a flow from what its cold login asks for.
 *
 * <p>A step whose `preHook` awaits `otpCodeRetriever` waits for the user's
 * one-time code, so a flow with one pays an SMS when it falls back. Any other
 * flow does not — including one whose hook waits on a different credential.
 * This is the same OTP-step rule `WarmStartContract` enforces.
 * @param config - API-direct-call config.
 * @returns The clause every fallback warning for this flow ends with.
 */
function coldFallbackDetail(config: IApiDirectCallConfig): string {
  const hasOtpStep = config.steps.some(step => step.preHook?.awaitCredsField === OTP_CREDS_FIELD);
  const kind: ColdLoginKind = hasOtpStep ? 'otp' : 'password';
  return COLD_FALLBACK_DETAIL[kind];
}

export {
  COLD_FALLBACK_DEGRADED,
  COLD_FALLBACK_STALE,
  COLD_FALLBACK_WARM_FAILED,
  coldFallbackDetail,
  PHASE_LABEL,
  safeInvoke,
};
export type { IAuthFlowCallback };
