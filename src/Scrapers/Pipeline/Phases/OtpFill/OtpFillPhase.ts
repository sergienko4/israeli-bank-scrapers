/**
 * OTP Fill phase — thin orchestration, all logic in Mediator.
 * PRE:    discover code input + submit button (passive, post-transition)
 * ACTION: call retriever → fill code → click submit (executioner)
 * POST:   validate OTP accepted (form error + re-probe)
 * FINAL:  cookie audit + handoff to DASHBOARD
 */

import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import {
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../Mediator/OtpFill/OtpFillPhaseActions.js';
import { OTP_FILL_PRELUDE_TIMEOUT_MS } from '../../Mediator/Timing/TimingConfig.js';
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

/** OTP-FILL prelude table — PRE waits for DOM-ready; others no-op. */
const OTP_FILL_PRELUDE_TABLE: Record<'PRE' | 'ACTION' | 'POST' | 'FINAL', IPreludeSpec> = {
  PRE: { level: 'dom', timeoutMs: OTP_FILL_PRELUDE_TIMEOUT_MS },
  ACTION: PRELUDE_NONE,
  POST: PRELUDE_NONE,
  FINAL: PRELUDE_NONE,
};

/** OTP Fill phase — BasePhase with PRE/ACTION/POST/FINAL. */
class OtpFillPhase extends BasePhase {
  public readonly name = 'otp-fill' as const;

  /** Whether OTP is mandatory; false enables soft-skip on missing input. */
  public required = true;

  private readonly _preludeTable = OTP_FILL_PRELUDE_TABLE;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return executeFillPre(input, this.required);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-fill.action' });
    return executeFillAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-fill.post' });
    return executeFillPost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'otp-fill.final' });
    return executeFillFinal(input);
  }

  /**
   * OTP-FILL requires DOM-ready before the OTP code input is scanned in
   * PRE. ACTION fills + submits (no nav); POST + FINAL validate. Only
   * PRE pays the prelude budget.
   *
   * @param stage - The stage about to execute.
   * @returns DOM prelude for PRE; none otherwise.
   */
  protected override prelude(stage: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): IPreludeSpec {
    return this._preludeTable[stage];
  }
}

/**
 * Create the OTP Fill phase instance.
 * @param required - Whether OTP is mandatory (default true).
 * @returns OtpFillPhase.
 */
function createOtpFillPhase(required = true): OtpFillPhase {
  const phase = Reflect.construct(OtpFillPhase, []);
  phase.required = required;
  return phase;
}

export { createOtpFillPhase, OTP_FILL_STEP, OtpFillPhase };
