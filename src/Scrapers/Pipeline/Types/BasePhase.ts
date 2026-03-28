/**
 * Abstract BasePhase — Template Method for the 4-stage phase protocol.
 * PRE → ACTION → POST → FINAL. Each stage returns Procedure<IPipelineContext>.
 *
 * run() is the ONLY entry point — bakes in Guard Clauses (Rule #15).
 * Subclasses MUST implement action(). Pre/post/final have default no-ops.
 * TypeScript compiler refuses to build a phase missing action().
 */

import type { PhaseName } from './Phase.js';
import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';
import { succeed } from './Procedure.js';

/** Abstract base for all pipeline phases. */
abstract class BasePhase {
  /** Phase identifier — must match the pipeline execution order. */
  public abstract readonly name: PhaseName;

  /**
   * ACTION — the core logic of the phase. MUST be implemented.
   * @param ctx - Pipeline context from PRE.
   * @param input - Same as ctx (immutable accumulation pattern).
   * @returns Updated context or failure.
   */
  public abstract action(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>>;

  /**
   * PRE — discovery step before the main action. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * POST — validation after action. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * FINAL — readiness signal for the next phase. Default: no-op passthrough.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * Template Method — the ONLY way to execute a phase.
   * Enforces PRE → ACTION → POST → FINAL with Guard Clauses.
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  public async run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    const preResult = await this.pre(ctx, ctx);
    if (!preResult.success) return preResult;
    const actionResult = await this.action(preResult.value, preResult.value);
    if (!actionResult.success) return actionResult;
    const postResult = await this.post(actionResult.value, actionResult.value);
    if (!postResult.success) return postResult;
    return this.final(postResult.value, postResult.value);
  }
}

export default BasePhase;
export { BasePhase };
