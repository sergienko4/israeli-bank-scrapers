/**
 * Phase H.T3c.10 — fixture-driven IPipelineContext builder for the
 * cross-bank TERMINATE per-phase factory.
 *
 * <p>TERMINATE PRE/POST/FINAL contracts (per `TerminateActions.ts`):
 * all three actions always succeed by design — cleanup errors are
 * swallowed so the pipeline can finish even when teardown encounters
 * resource failures. The factory exercises the cross-bank wiring
 * regression mode (was a bank's pipeline builder accidentally
 * dropped TERMINATE from its sequence?) by driving each bank
 * through the three actions with a fresh mock context.
 */

import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';

/** Result of {@link buildTerminatePhaseContext} — PRE+POST+FINAL replay-ready. */
export interface ITerminatePhaseTestSubject {
  readonly context: IPipelineContext;
}

/**
 * Build a TERMINATE-stage test subject. Uses the bare mock context
 * — TERMINATE has no per-bank shape requirements at PRE/POST/FINAL
 * time (cleanups + diagnostics stamping only).
 *
 * @returns Context ready for TERMINATE.PRE+POST+FINAL replay.
 */
export function buildTerminatePhaseContext(): ITerminatePhaseTestSubject {
  const base = makeMockContext();
  return { context: base };
}
