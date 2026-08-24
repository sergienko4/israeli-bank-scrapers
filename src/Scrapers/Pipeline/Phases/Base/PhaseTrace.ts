/**
 * Phase-trace primitives — small branded types + tag table the BasePhase
 * Template Method emits at every stage boundary so structured log
 * consumers (Pino, pipeline diagnostics) can pivot on a single discriminator.
 *
 * <p>Extracted during Phase 12b from the original monolithic phase
 * module along with the other pure helpers in this folder. Re-exported
 * through {@link "./BasePhase.js"} so callers reach it by the same
 * path as the class itself.
 *
 * @see "./BasePhase.ts" — the Template Method that emits these tags.
 * @see "./HandoffHelpers.ts" — sibling helper file that consumes
 *   {@link PHASE_STAGE_EVENT} indirectly via the same trace contract.
 */

import type { Brand } from '../../Types/Brand.js';
import type { PipelineLogEvent } from '../../Types/LogEvent.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Trace tag — 'OK' or 'FAIL'. */
export type TraceTagStr = Brand<string, 'TraceTagStr'>;

/** Pino log-event discriminator emitted by every phase-stage debug line. */
export const PHASE_STAGE_EVENT = 'phase-stage' as const;

/** Lookup for success/fail trace tags. */
export const RESULT_TAG: Record<
  string,
  PipelineLogEvent['event'] extends string ? string : never
> = {
  true: 'OK',
  false: 'FAIL',
};

/**
 * Map Procedure success to trace tag.
 * @param r - Procedure result (any payload type).
 * @returns 'OK' or 'FAIL'.
 */
export function traceTag<T>(r: Procedure<T>): TraceTagStr {
  return RESULT_TAG[String(r.success)] as TraceTagStr;
}

/**
 * Build the reason fields that accompany a FAIL trace tag.
 *
 * <p>Why this exists. A stage previously logged only its `OK`/`FAIL`
 * tag, so a failing run produced a bare `FAIL` with nothing saying why.
 * A Discount run emitted that three times in a row and the reason could
 * only be recovered by downloading the forensic bundle and reading a
 * screenshot. Carrying the message inline makes the log self-explanatory
 * at the moment of failure.
 *
 * <p>Returns an empty object on success so the caller can spread it
 * unconditionally and healthy lines keep their existing shape.
 *
 * @param r - Procedure result (any payload type).
 * @returns Masked `errorType`/`errorMessage` on failure, else `{}`.
 */
export function traceReason<T>(r: Procedure<T>): Readonly<Record<string, string>> {
  if (r.success) return {};
  return { errorType: r.errorType, errorMessage: maskVisibleText(r.errorMessage) };
}
