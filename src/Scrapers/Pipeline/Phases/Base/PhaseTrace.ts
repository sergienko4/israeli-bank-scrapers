/**
 * Phase-trace primitives — small branded types + tag table the BasePhase
 * Template Method emits at every stage boundary so structured log
 * consumers (Pino, pipeline diagnostics) can pivot on a single discriminator.
 *
 * <p>Extracted during Phase 12b from `Pipeline/Types/BasePhase.ts` along
 * with the other pure helpers in this folder. Public re-export through
 * {@link "../../Types/BasePhase.js"} keeps the v8.5 release-window shim
 * byte-identical so every external importer continues to work without
 * a path change.
 *
 * @see "./BasePhase.ts" — the Template Method that emits these tags.
 * @see "./HandoffHelpers.ts" — sibling helper file that consumes
 *   {@link PHASE_STAGE_EVENT} indirectly via the same trace contract.
 */

import type { Brand } from '../../Types/Brand.js';
import type { PipelineLogEvent } from '../../Types/LogEvent.js';
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
