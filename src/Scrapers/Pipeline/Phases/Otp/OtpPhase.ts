/**
 * OTP phase — thin orchestration, all logic in Mediator/Otp.
 * PRE:    detect OTP form via mediator (WellKnown mfa field)
 * ACTION: if OTP detected, delegate to handler (stub)
 * POST:   validate OTP result (no-op for now)
 * FINAL:  signal readiness to DASHBOARD
 */

import {
  executeDetectOtp,
  executeHandleOtp,
  executeSignalToDashboard,
  executeValidateOtp,
} from '../../Mediator/Otp/OtpPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/**
 * Compat step — use createOtpPhase() for new code.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Succeed(input).
 */
function otpStepExec(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Compat step — tests use .execute(). Prefer createOtpPhase(). */
const OTP_STEP = { name: 'otp' as const, execute: otpStepExec };

/** OTP phase — BasePhase with PRE/ACTION/POST/FINAL. */
class OtpPhase extends BasePhase {
  public readonly name = 'otp' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeDetectOtp(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeHandleOtp(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeValidateOtp(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeSignalToDashboard(input);
  }
}

/**
 * Create the OTP phase instance.
 * @returns OtpPhase.
 */
function createOtpPhase(): OtpPhase {
  return new OtpPhase();
}

export { createOtpPhase, OTP_STEP, OtpPhase };
