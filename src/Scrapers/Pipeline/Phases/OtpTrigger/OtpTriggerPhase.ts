/**
 * OTP Trigger phase — thin orchestration, all logic in Mediator.
 * PRE:    detect trigger button via WK (passive discovery)
 * ACTION: click trigger (Hand follows Eye)
 * POST:   validate trigger completed (screenshot)
 * FINAL:  handoff contextId + phoneHint to OtpFill phase
 */

import {
  executeTriggerAction,
  executeTriggerFinal,
  executeTriggerPost,
  executeTriggerPre,
} from '../../Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/**
 * Compat step — use createOtpTriggerPhase() for new code.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Succeed(input).
 */
function otpTriggerStepExec(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Compat step for tests. */
const OTP_TRIGGER_STEP = {
  name: 'otp-trigger' as const,
  execute: otpTriggerStepExec,
};

/** OTP Trigger phase — BasePhase with PRE/ACTION/POST/FINAL. */
class OtpTriggerPhase extends BasePhase {
  public readonly name = 'otp-trigger' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeTriggerPre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    return executeTriggerAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeTriggerPost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeTriggerFinal(input);
  }
}

/**
 * Create the OTP Trigger phase instance.
 * @returns OtpTriggerPhase.
 */
function createOtpTriggerPhase(): OtpTriggerPhase {
  return Reflect.construct(OtpTriggerPhase, []);
}

export { createOtpTriggerPhase, OTP_TRIGGER_STEP, OtpTriggerPhase };
