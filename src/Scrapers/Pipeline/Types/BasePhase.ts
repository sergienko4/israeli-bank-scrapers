/**
 * Abstract BasePhase — Template Method for the 4-stage phase protocol.
 * PRE → ACTION → POST → FINAL. Each stage returns Procedure<IPipelineContext>.
 *
 * run() is the ONLY entry point — bakes in Guard Clauses (Rule #15).
 * Subclasses MUST implement action(). Pre/post/final have default no-ops.
 * TypeScript compiler refuses to build a phase missing action().
 */

import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';
import { succeed } from './Procedure.js';

import type { PhaseName } from './Phase.js';

/** Abstract base for all pipeline phases. */
abstract class BasePhase {
  /** Phase identifier — must match the pipeline execution order. */
  abstract readonly name: PhaseName;

  /**
   * ACTION — the core logic of the phase. MUST be implemented.
   * @param ctx - Pipeline context from PRE.
   * @param input - Same as ctx (immutable accumulation pattern).
   * @returns Updated context or failure.
   */
  abstract action(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>>;

  /**
   * PRE — discovery step before the main action. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  async pre(_ctx: IPipelineContext, input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    return succeed(input);
  }

  /**
   * POST — validation after action. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return succeed(input);
  }

  /**
   * FINAL — readiness signal for the next phase. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return succeed(input);
  }

  /**
   * Template Method — the ONLY way to execute a phase.
   * Enforces PRE → ACTION → POST → FINAL with Guard Clauses.
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  async run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    const preResult = await this.pre(ctx, ctx);
    if (!preResult.success) return preResult;
    const actionResult = await this.action(preResult.value, preResult.value);
    if (!actionResult.success) return actionResult;
    const postResult = await this.post(actionResult.value, actionResult.value);
    if (!postResult.success) return postResult;
    return this.final(postResult.value, postResult.value);
  }
}

/**
 * SimplePhase — wraps a single action step into a BasePhase.
 * Used for phases that only need ACTION (pre/post/final are no-ops).
 * Replaces the old `actionOnly()` pattern.
 */
class SimplePhase extends BasePhase {
  public readonly name: PhaseName;

  private readonly _action: (
    ctx: IPipelineContext,
    input: IPipelineContext,
  ) => Promise<Procedure<IPipelineContext>>;

  /**
   * Create a simple phase with only an action.
   * @param phaseName - Phase identifier.
   * @param actionFn - The action function to execute.
   */
  constructor(
    phaseName: PhaseName,
    actionFn: (
      ctx: IPipelineContext,
      input: IPipelineContext,
    ) => Promise<Procedure<IPipelineContext>>,
  ) {
    super();
    this.name = phaseName;
    this._action = actionFn;
  }

  /**
   * ACTION — delegates to the wrapped function.
   * @param ctx - Pipeline context.
   * @param input - Pipeline context.
   * @returns Result from the wrapped action.
   */
  async action(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return this._action(ctx, input);
  }
}

export { BasePhase, SimplePhase };
