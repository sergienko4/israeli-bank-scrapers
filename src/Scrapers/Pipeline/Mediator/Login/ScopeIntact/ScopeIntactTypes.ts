/**
 * Types + log constants for the LoginScopeIntact validator cluster.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginScopeIntact.ts}.
 */

import type { IPipelineContext, IResolvedTarget } from '../../../Types/PipelineContext.js';
import type { IRaceResult } from '../../Elements/ElementMediator.js';

/** Diagnostic log: scope intact but OTP screen rendered (fall-through). */
export const SCOPE_OTP_VISIBLE_LOG = 'POST: scope intact but OTP screen rendered — fall through';

/** Diagnostic log: OTP probe failed → unknown verdict (fall-through). */
export const SCOPE_OTP_UNKNOWN_LOG = 'POST: OTP probe failed — fall through (unknown ≠ invalid)';

/** Failure message: scope intact + URL unchanged → invalid credentials. */
export const SCOPE_INTACT_FAIL_MSG =
  'LOGIN POST: scope intact + URL unchanged — credentials likely invalid';

/** Lookup mapping OTP-visibility verdicts → the fall-through trace log. */
export const SCOPE_OTP_FALLTHROUGH_LOGS: Partial<Record<string, string>> = {
  true: SCOPE_OTP_VISIBLE_LOG,
  unknown: SCOPE_OTP_UNKNOWN_LOG,
};

/** Bundled state for the scope-intact failure path. */
export interface IScopeIntactArgs {
  readonly input: IPipelineContext;
  readonly selector: string;
  readonly count: number;
}

/** Tri-state outcome for the OTP-screen probe. */
export type OtpScreenVisibility = boolean | 'unknown';

/** Outcome of a single OTP detect call. */
export type ProbeOutcome = IRaceResult | 'failed';

/** Sentinel value: OTP detect probe rejected. */
export const PROBE_FAILED: ProbeOutcome = 'failed';

/** Probe outcome: resolved password target + match count, or `false` on miss. */
export type ScopeProbe = { readonly target: IResolvedTarget; readonly count: number } | false;
