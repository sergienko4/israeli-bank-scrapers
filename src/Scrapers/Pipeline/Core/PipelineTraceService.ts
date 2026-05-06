/**
 * Pipeline trace service — emits structured phase-lifecycle events.
 * Infrastructure concern — lives in Core/, not Types/.
 */

import type { Brand } from '../Types/Brand.js';
import type { ScraperLogger } from '../Types/Debug.js';

/** Phase index tag string (e.g. '1/7') — branded for Rule #15. */
type PhaseIndexTag = Brand<string, 'PhaseIndexTag'>;
/** Trace emit outcome — branded for Rule #15. */
type DidTrace = Brand<boolean, 'DidTrace'>;

/** Outcome lookup — avoids ternary. */
const OUTCOME: Record<string, string> = { true: 'OK', false: 'FAIL' };

/**
 * Build phase index tag for log context.
 * @param index - 0-based phase index.
 * @param total - Total phase count.
 * @returns Formatted index string (e.g. '1/7').
 */
function buildPhaseIndex(index: number, total: number): PhaseIndexTag {
  return `${String(index + 1)}/${String(total)}` as PhaseIndexTag;
}

/**
 * Emit phase start event via structured logger.
 * @param logger - Pino logger from context.
 * @param name - Phase name.
 * @param indexTag - Phase index tag.
 * @returns True after tracing.
 */
function traceStart(logger: ScraperLogger, name: string, indexTag: string): DidTrace {
  logger.debug({ phase: name, action: 'START', index: indexTag });
  return true as DidTrace;
}

/**
 * Emit phase result event via structured logger.
 * @param ctx - Bundled trace context (logger, name, indexTag, isSuccess).
 * @returns True after tracing.
 */
interface ITraceResultCtx {
  readonly logger: ScraperLogger;
  readonly name: string;
  readonly indexTag: string;
  readonly isSuccess: boolean;
}

/**
 * Emit phase result event via structured logger.
 * @param ctx - Bundled trace context.
 * @returns True after tracing.
 */
function traceResult(ctx: ITraceResultCtx): DidTrace {
  const action = OUTCOME[String(ctx.isSuccess)];
  ctx.logger.debug({ phase: ctx.name, action, index: ctx.indexTag });
  return true as DidTrace;
}

export default buildPhaseIndex;
export { buildPhaseIndex, traceResult, traceStart };
