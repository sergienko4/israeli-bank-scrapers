/**
 * Abstract BasePhase — Template Method for the 4-stage phase protocol.
 * PRE -> ACTION -> POST -> FINAL. Each stage returns Procedure<IPipelineContext>.
 *
 * run() is the ONLY entry point — bakes in Guard Clauses (Rule #15).
 * A thrown error bubbles up to the pipeline reducer, which converts it to a
 * Procedure failure in one place (`wrapError`).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import type { Brand } from '../../Types/Brand.js';
import type PhaseName from '../../Types/Phase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { PHASE_STAGE_EVENT, traceReason, traceTag } from './PhaseTrace.js';

/** PRE-payload validation outcome — branded for Rule #15. */
export type IsPrePayloadValid = Brand<boolean, 'IsPrePayloadValid'>;

/** Uppercase stage tag emitted in trace events + ActiveState. */
type StageTagUpper = 'PRE' | 'ACTION' | 'POST' | 'FINAL';

/** Common return type for every stage runner. */
type StageOutcome = Promise<Procedure<IPipelineContext>>;

/** Logger handle from the pipeline context (frequent param). */
type StageLogger = IPipelineContext['logger'];

/** Abstract base for all pipeline phases. */
abstract class BasePhase {
  /** Phase identifier — must match the pipeline execution order. */
  public abstract readonly name: PhaseName;

  /**
   * ACTION — the core execution.
   * @param ctx - Context produced by PRE.
   * @param input - Same as ctx.
   * @returns Updated context or failure.
   */
  public abstract action(
    ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>>;

  /**
   * Template Method — the ONLY way to execute a phase.
   * Enforces PRE -> ACTION -> POST -> FINAL with Guard Clauses.
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  public run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    setActivePhase(this.name);
    return this.runStages(ctx, ctx.logger);
  }

  /**
   * PRE — validation / preparation step. Default: pass through unchanged.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return this.passThrough(input);
  }

  /**
   * POST — validation after action. Default: pass through unchanged.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return this.passThrough(input);
  }

  /**
   * FINAL — readiness signal. Default: pass through unchanged.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return this.passThrough(input);
  }

  /**
   * Phase-name accessor — subclasses call this from no-this overrides to
   * satisfy `class-methods-use-this`.
   * @returns Phase name.
   */
  protected phaseName(): PhaseName {
    return this.name;
  }

  /**
   * Pass-through helper used by the PRE/POST/FINAL defaults. Tags the log
   * with the phase name so the inherited override references `this`.
   * @param input - Pipeline context to forward unchanged.
   * @returns Succeed with input wrapped in a resolved promise.
   */
  protected passThrough(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ message: `[${this.name}] pass-through` });
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * Validate PRE produced a valid payload for ACTION. Override per phase.
   * @param ctx - Context after PRE completed.
   * @returns True if payload valid for ACTION.
   */
  protected validatePrePayload(ctx: IPipelineContext): IsPrePayloadValid {
    return (Boolean(ctx) && this.name.length > 0) as IsPrePayloadValid;
  }

  /**
   * Drive the 4-stage protocol, stopping at the first failure.
   * @param ctx - Pipeline context at phase entry.
   * @param log - Logger instance.
   * @returns Final context after all 4 stages, or first failure.
   */
  private async runStages(ctx: IPipelineContext, log: StageLogger): StageOutcome {
    const pre = await this.runStage('PRE', log, () => this.pre(ctx, ctx));
    if (!pre.success) return pre;
    if (!this.validatePrePayload(pre.value)) return this.contractViolation();
    return this.runAfterPre(pre.value, log);
  }

  /**
   * Drive ACTION → POST → FINAL, stopping at the first failure.
   * @param input - Context produced by PRE (validated payload).
   * @param log - Logger instance.
   * @returns Final phase context, or first stage failure.
   */
  private async runAfterPre(input: IPipelineContext, log: StageLogger): StageOutcome {
    const action = await this.runStage('ACTION', log, () => this.action(input, input));
    if (!action.success) return action;
    const post = await this.runStage('POST', log, () => this.post(action.value, action.value));
    if (!post.success) return post;
    return this.runStage('FINAL', log, () => this.final(post.value, post.value));
  }

  /**
   * Run one stage: mark it active, execute it, emit its trace event.
   * @param stage - Uppercase stage tag.
   * @param log - Logger instance.
   * @param runner - Stage body.
   * @returns The stage result.
   */
  private async runStage(
    stage: StageTagUpper,
    log: StageLogger,
    runner: () => StageOutcome,
  ): StageOutcome {
    setActiveStage(stage);
    const result = await runner();
    this.logStage(log, stage, result);
    return result;
  }

  /**
   * Build contract violation failure for invalid PRE payload.
   * @returns Failure Procedure with contract message.
   */
  private contractViolation(): Procedure<IPipelineContext> {
    const msg = `STAGE_CONTRACT_VIOLATION: ${this.name}.PRE OK but no target payload`;
    return fail(ScraperErrorTypes.Generic, msg);
  }

  /**
   * Emit the structured `phase-stage` debug event for a completed stage.
   * A FAIL additionally carries its reason via {@link traceReason}.
   * @param log - Logger instance.
   * @param stage - Uppercase stage tag emitted on the wire.
   * @param result - Procedure result whose success bit becomes the tag.
   */
  private logStage<T>(log: StageLogger, stage: StageTagUpper, result: Procedure<T>): void {
    const tag = traceTag(result);
    const base = { event: PHASE_STAGE_EVENT, phase: this.name, stage, result: tag };
    log.debug({ ...base, ...traceReason(result) });
  }
}

export default BasePhase;
export { BasePhase };
