/**
 * OTP-screen probes used by the scope-intact disambiguator.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginScopeIntact.ts}.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../../Elements/ElementMediator.js';
import { detectOtpForm, detectOtpTrigger } from '../../Form/OtpProbe.js';
import {
  type OtpScreenVisibility,
  PROBE_FAILED,
  type ProbeOutcome,
  SCOPE_OTP_FALLTHROUGH_LOGS,
} from './ScopeIntactTypes.js';

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
 * Run a single OTP detect probe and translate into a flat ProbeOutcome.
 * @param probe - OTP-screen detector function.
 * @param mediator - Element mediator.
 * @returns Race result on success; `'failed'` on resolver rejection.
 */
export async function runOtpDetect(
  probe: (m: IElementMediator) => Promise<Procedure<IRaceResult>>,
  mediator: IElementMediator,
): Promise<ProbeOutcome> {
  const result = await probe(mediator).catch((): false => false);
  if (result === false) return PROBE_FAILED;
  return unwrapOtpProcedure(result);
}

/**
 * Probe the post-submit DOM for an OTP-trigger or OTP-input element.
 * @param mediator - Element mediator.
 * @returns Tri-state OTP visibility verdict.
 */
export async function otpScreenVisible(mediator: IElementMediator): Promise<OtpScreenVisibility> {
  const triggerProbe = runOtpDetect(detectOtpTrigger, mediator);
  const formProbe = runOtpDetect(detectOtpForm, mediator);
  const [triggerOutcome, formOutcome] = await Promise.all([triggerProbe, formProbe]);
  if (triggerOutcome !== 'failed' && triggerOutcome.found) return true;
  if (formOutcome !== 'failed' && formOutcome.found) return true;
  if (triggerOutcome === 'failed' || formOutcome === 'failed') return 'unknown';
  return false;
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
