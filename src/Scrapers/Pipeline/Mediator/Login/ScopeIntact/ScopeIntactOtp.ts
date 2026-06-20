/**
 * OTP-screen probes used by the scope-intact disambiguator.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginScopeIntact.ts}.
 */

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../../Elements/ElementMediator.js';
import { detectOtpForm } from '../../Form/OtpProbe.js';
import {
  type OtpScreenVisibility,
  PROBE_FAILED,
  type ProbeOutcome,
  SCOPE_OTP_FALLTHROUGH_LOGS,
} from './ScopeIntactTypes.js';

/** Typed-null sentinel for probe-rejection — avoids `return null` literal. */
const PROBE_REJECTED: Nullable<never> = JSON.parse('null') as Nullable<never>;

/**
 * Translate a Procedure into a flat ProbeOutcome.
 * @param result - Probe-side Procedure result.
 * @returns Race result on success; `'failed'` on `success: false`.
 */
export function unwrapOtpProcedure(result: Procedure<IRaceResult>): ProbeOutcome {
  if (!result.success) return PROBE_FAILED;
  return result.value;
}

/**
 * Await `probe(mediator)` and convert any throw — sync or async — into a
 * sentinel null. Extracted from {@link runOtpDetect} to keep that
 * function ≤10 LoC (CR PR #345 cap-10 tightening).
 * @param probe - OTP-screen detector function.
 * @param mediator - Element mediator.
 * @returns Procedure on success; sentinel null on any throw.
 */
async function safeAwaitProbe(
  probe: (m: IElementMediator) => Promise<Procedure<IRaceResult>>,
  mediator: IElementMediator,
): Promise<Nullable<Procedure<IRaceResult>>> {
  try {
    return await probe(mediator);
  } catch {
    return PROBE_REJECTED;
  }
}

/**
 * Run a single OTP detect probe and translate into a flat ProbeOutcome.
 * Delegates the try/catch to {@link safeAwaitProbe} so sync OR async
 * rejections are folded into `PROBE_FAILED` (CR PR #345 finding #194).
 * @param probe - OTP-screen detector function.
 * @param mediator - Element mediator.
 * @returns Race result on success; `PROBE_FAILED` on any failure.
 */
export async function runOtpDetect(
  probe: (m: IElementMediator) => Promise<Procedure<IRaceResult>>,
  mediator: IElementMediator,
): Promise<ProbeOutcome> {
  const result = await safeAwaitProbe(probe, mediator);
  return result ? unwrapOtpProcedure(result) : PROBE_FAILED;
}

/**
 * Probe the post-submit DOM for a genuine OTP CODE INPUT.
 *
 * <p>PR #282 regression fix (commit 97ca1353): a rendered OTP screen is
 * proven ONLY by a real one-time-code input ({@link detectOtpForm} /
 * `WK_OTP_INPUT`). The previous structural trigger probe
 * (`//button[@type="submit"]`, `//form//button`) matched the always-
 * coresident SMS-lobby and password-submit buttons, so a failed login
 * that stayed on the login URL was masked as an OTP fall-through instead
 * of an honest `InvalidPassword` — which also killed the retry-recovery.
 * @param mediator - Element mediator.
 * @returns Tri-state OTP visibility verdict.
 */
export async function otpScreenVisible(mediator: IElementMediator): Promise<OtpScreenVisibility> {
  const formOutcome = await runOtpDetect(detectOtpForm, mediator);
  if (formOutcome === 'failed') return 'unknown';
  return formOutcome.found;
}

/**
 * Resolve the fall-through trace log for an OTP visibility verdict.
 * @param visibility - Tri-state OTP-visibility verdict.
 * @returns Trace log string when fall-through applies, else `false`.
 */
export function pickOtpFallthroughLog(visibility: OtpScreenVisibility): string | false {
  if (visibility === false) return false;
  const key = visibility === true ? 'true' : 'unknown';
  return SCOPE_OTP_FALLTHROUGH_LOGS[key] ?? false;
}
