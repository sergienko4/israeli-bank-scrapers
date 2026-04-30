/**
 * OTP Fill phase — thin orchestration, all logic in Mediator.
 * PRE:    discover code input + submit button (passive, post-transition)
 * ACTION: call retriever → fill code → click submit (executioner)
 * POST:   validate OTP accepted (form error + re-probe)
 * FINAL:  cookie audit + handoff to DASHBOARD
 */

import {
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../Mediator/OtpFill/OtpFillPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/**
 * Compat step — use createOtpFillPhase() for new code.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Succeed(input).
 */
function otpFillStepExec(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Compat step for tests. */
const OTP_FILL_STEP = {
  name: 'otp-fill' as const,
  execute: otpFillStepExec,
};

/** OTP Fill phase — BasePhase with PRE/ACTION/POST/FINAL. */
class OtpFillPhase extends BasePhase {
  public readonly name = 'otp-fill' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeFillPre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    return executeFillAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeFillPost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeFillFinal(input);
  }
}

/**
 * Create the OTP Fill phase instance.
 * @returns OtpFillPhase.
 */
function createOtpFillPhase(): OtpFillPhase {
  return Reflect.construct(OtpFillPhase, []);
}

export { createOtpFillPhase, OTP_FILL_STEP, OtpFillPhase };
