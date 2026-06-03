/**
 * OTP-TRIGGER FINAL — emits `ctx.otpTrigger` with the slim
 * {@link IOtpTrigger} value type for downstream consumers.
 */

import { some } from '../../Types/Option.js';
import type { IOtpTrigger, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { readDiagTarget } from '../Otp/OtpShared.js';

/**
 * Read the boolean `triggerScopeValidated` POST stamped. Falls back
 * to `false` when missing.
 * @param diag - Pipeline diagnostics record.
 * @returns Stamped boolean or false.
 */
function readScopeValidated(diag: IPipelineContext['diagnostics']): boolean {
  const wasValidated = diag.triggerScopeValidated;
  if (typeof wasValidated !== 'boolean') return false;
  return wasValidated;
}

/**
 * Read the `otpPhoneHint` PRE stamped. Falls back to `''` when missing.
 * @param diag - Pipeline diagnostics record.
 * @returns Stamped string or `''`.
 */
function readPhoneHint(diag: IPipelineContext['diagnostics']): string {
  const raw = (diag as unknown as { readonly otpPhoneHint?: unknown }).otpPhoneHint;
  if (typeof raw !== 'string') return '';
  return raw;
}

/**
 * Build the slim {@link IOtpTrigger} snapshot from accumulated
 * diagnostics. Pure — no side effects.
 * @param input - Pipeline context (carries OTP-TRIGGER.PRE captures).
 * @returns Slim OTP-TRIGGER value snapshot.
 */
function buildOtpTriggerSnapshot(input: IPipelineContext): IOtpTrigger {
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  return {
    phoneHint: readPhoneHint(input.diagnostics),
    triggered: target !== false,
    scopeValidated: readScopeValidated(input.diagnostics),
    urlBeforeSubmit: input.diagnostics.otpTriggerPreUrl ?? '',
  };
}

/** Procedure alias keeping single-line signatures. */
type FinalProc = Procedure<IPipelineContext>;

/**
 * Emit the FINAL commit telemetry and bind the snapshot to
 * `ctx.otpTrigger`.
 * @param input - Pipeline context.
 * @param snapshot - Pre-built OTP-TRIGGER snapshot.
 * @returns Success with updated context.
 */
function commitOtpTrigger(input: IPipelineContext, snapshot: IOtpTrigger): FinalProc {
  input.logger.debug({
    event: 'otp-trigger.committed',
    triggered: snapshot.triggered,
    scopeValidated: snapshot.scopeValidated,
    phoneHintLength: snapshot.phoneHint.length,
  });
  const diag = { ...input.diagnostics, lastAction: 'otp-trigger-final (committed)' };
  return succeed({ ...input, diagnostics: diag, otpTrigger: some(snapshot) });
}

/**
 * FINAL: Emit `ctx.otpTrigger` with the slim {@link IOtpTrigger} value.
 * @param input - Pipeline context.
 * @returns Updated context with `otpTrigger` populated.
 */
function executeTriggerFinal(input: IPipelineContext): Promise<FinalProc> {
  const snapshot = buildOtpTriggerSnapshot(input);
  const committed = commitOtpTrigger(input, snapshot);
  return Promise.resolve(committed);
}

export default executeTriggerFinal;
