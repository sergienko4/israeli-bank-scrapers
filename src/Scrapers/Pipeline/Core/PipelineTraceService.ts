/**
 * Pipeline trace service — emits structured phase-lifecycle events.
 * Infrastructure concern — lives in Core/, not Types/.
 */

import type { ScraperLogger } from '../Types/Debug.js';

/** Trace outcome after phase execution. */
type TraceTag = string;
/** Whether tracing was emitted. */
type DidTrace = boolean;

/** Outcome lookup — avoids ternary. */
const OUTCOME: Record<string, string> = { true: 'OK', false: 'FAIL' };

/**
 * Build phase index tag for log context.
 * @param index - 0-based phase index.
 * @param total - Total phase count.
 * @returns Formatted index string (e.g. '1/7').
 */
function buildPhaseIndex(index: number, total: number): TraceTag {
  return `${String(index + 1)}/${String(total)}`;
}

/**
 * Emit phase start event via structured logger.
 * @param logger - Pino logger from context.
 * @param name - Phase name.
 * @param indexTag - Phase index tag.
 * @returns True after tracing.
 */
function traceStart(logger: ScraperLogger, name: TraceTag, indexTag: TraceTag): DidTrace {
  logger.debug({ event: 'phase-lifecycle', phase: name, action: 'START', index: indexTag });
  return true;
}

/**
 * Emit phase result event via structured logger.
 * @param ctx - Bundled trace context (logger, name, indexTag, isSuccess).
 * @returns True after tracing.
 */
interface ITraceResultCtx {
  readonly logger: ScraperLogger;
  readonly name: TraceTag;
  readonly indexTag: TraceTag;
  readonly isSuccess: DidTrace;
}

/**
 * Emit phase result event via structured logger.
 * @param ctx - Bundled trace context.
 * @returns True after tracing.
 */
function traceResult(ctx: ITraceResultCtx): DidTrace {
  const action = OUTCOME[String(ctx.isSuccess)];
  ctx.logger.debug({ event: 'phase-lifecycle', phase: ctx.name, action, index: ctx.indexTag });
  return true;
}

export default buildPhaseIndex;
export { buildPhaseIndex, traceResult, traceStart };
