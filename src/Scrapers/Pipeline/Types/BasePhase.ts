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

/** Lookup for success/fail trace tags. */
const RESULT_TAG: Record<string, string> = { true: 'OK', false: 'FAIL' };

/**
 * Map Procedure success to trace tag.
 * @param r - Procedure result.
 * @returns 'OK' or 'FAIL'.
 */
function traceTag(r: Procedure<IPipelineContext>): string {
  return RESULT_TAG[String(r.success)];
}

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
   * Uses this.name for phase identity tracing.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * POST — validation after action. Default: no-op passthrough.
   * Uses this.name for phase identity tracing.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * FINAL — readiness signal for the next phase. Default: no-op passthrough.
   * Uses this.name for phase identity tracing.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op).
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
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
    process.stderr.write(`  [${this.name}] PRE → ${traceTag(preResult)}\n`);
    if (!preResult.success) return preResult;
    const actionResult = await this.action(preResult.value, preResult.value);
    process.stderr.write(`  [${this.name}] ACTION → ${traceTag(actionResult)}\n`);
    if (!actionResult.success) return actionResult;
    const postResult = await this.post(actionResult.value, actionResult.value);
    process.stderr.write(`  [${this.name}] POST → ${traceTag(postResult)}\n`);
    if (!postResult.success) return postResult;
    const finalResult = await this.final(postResult.value, postResult.value);
    process.stderr.write(`  [${this.name}] FINAL → ${traceTag(finalResult)}\n`);
    return finalResult;
  }
}

export default BasePhase;
export { BasePhase };
