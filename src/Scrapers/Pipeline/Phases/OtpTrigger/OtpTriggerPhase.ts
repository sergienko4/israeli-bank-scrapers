/**
 * OTP Trigger phase — thin orchestration, all logic in Mediator.
 * PRE:    detect trigger button via WK (passive discovery)
 * ACTION: click trigger (Hand follows Eye)
 * POST:   validate trigger completed (screenshot)
 * FINAL:  handoff contextId + phoneHint to OtpFill phase
 */

import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import {
  executeTriggerAction,
  executeTriggerFinal,
  executeTriggerPost,
  executeTriggerPre,
} from '../../Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
import { OTP_TRIGGER_PRELUDE_TIMEOUT_MS } from '../../Mediator/Timing/TimingConfig.js';
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

/** OTP-TRIGGER prelude spec — DOM-ready for PRE + ACTION. */
const OTP_TRIGGER_DOM: IPreludeSpec = { level: 'dom', timeoutMs: OTP_TRIGGER_PRELUDE_TIMEOUT_MS };

/** OTP-TRIGGER prelude table — PRE/ACTION wait for DOM-ready; POST/FINAL no-op. */
const OTP_TRIGGER_PRELUDE_TABLE: Record<'PRE' | 'ACTION' | 'POST' | 'FINAL', IPreludeSpec> = {
  PRE: OTP_TRIGGER_DOM,
  ACTION: OTP_TRIGGER_DOM,
  POST: PRELUDE_NONE,
  FINAL: PRELUDE_NONE,
};

/** OTP Trigger phase — BasePhase with PRE/ACTION/POST/FINAL. */
class OtpTriggerPhase extends BasePhase {
  public readonly name = 'otp-trigger' as const;
  private readonly _preludeTable = OTP_TRIGGER_PRELUDE_TABLE;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-trigger.pre' });
    return executeTriggerPre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-trigger.action' });
    return executeTriggerAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-trigger.post' });
    return executeTriggerPost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-trigger.final' });
    return executeTriggerFinal(input);
  }

  /**
   * OTP-TRIGGER requires DOM-ready before the phone-hint scan (PRE) and
   * before the "send code" click (ACTION). DOM parsing is sufficient —
   * OTP screens are typically already hydrated by the time the pipeline
   * reaches this phase after LOGIN.POST settled.
   *
   * @param stage - The stage about to execute.
   * @returns DOM prelude for PRE / ACTION; none otherwise.
   */
  /**
   * OTP-TRIGGER requires DOM-ready before the phone-hint scan (PRE) and
   * before the "send code" click (ACTION). DOM parsing is sufficient —
   * OTP screens are typically already hydrated by the time the pipeline
   * reaches this phase after LOGIN.POST settled.
   *
   * @param stage - The stage about to execute.
   * @returns DOM prelude for PRE / ACTION; none otherwise.
   */
  protected override prelude(stage: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): IPreludeSpec {
    return this._preludeTable[stage];
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
