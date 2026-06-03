/**
 * BalanceResolveActions.Final — FINAL orchestrator + REVEAL log
 * helpers. Extracted from the BalanceResolveActions barrel so the
 * per-file LoC cap is honoured (phase-2e-residue split).
 */

import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import type { IBalanceExtracted, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { EMPTY_EXTRACTED } from './BalanceResolveActions.Shared.js';

const LOG = createLogger('balance-resolve');

/**
 * Collapse extracted outcomes to a final number map.
 * @param extracted - Extracted outcomes per accountId.
 * @returns Final balance map.
 */
function buildFinalMap(extracted: IBalanceExtracted): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [accountId, outcome] of extracted) {
    out.set(accountId, outcome === 'MISS' ? 0 : outcome);
  }
  return out;
}

/** Counts surfaced from `ctx.balanceValidation` for FINAL reveal logging. */
interface IFinalRevealCounts {
  readonly resolvedCount: number;
  readonly missedCount: number;
}

/** Diagnostic payload for `balance-resolve.final` REVEAL log. */
interface IFinalRevealDiag {
  readonly event: 'balance-resolve.final';
  readonly resolvedCount: string;
  readonly missedCount: string;
  readonly totalCount: string;
  readonly message: string;
}

/**
 * Read resolved/missed counts from the optional balance-validation record.
 * @param input - Pipeline context.
 * @returns Counts bundle (zeros when validation option is empty).
 */
function readFinalRevealCounts(input: IPipelineContext): IFinalRevealCounts {
  if (!input.balanceValidation.has) return { resolvedCount: 0, missedCount: 0 };
  const validation = input.balanceValidation.value;
  return { resolvedCount: validation.resolvedIds.length, missedCount: validation.missedIds.length };
}

/**
 * Build the structured REVEAL log payload from the counts bundle.
 * @param counts - Resolved/missed counts from `readFinalRevealCounts`.
 * @param totalCount - Total account count from the extracted map.
 * @returns REVEAL diagnostic payload ready for `LOG.info`.
 */
function buildFinalRevealDiag(counts: IFinalRevealCounts, totalCount: number): IFinalRevealDiag {
  return {
    event: 'balance-resolve.final',
    resolvedCount: String(counts.resolvedCount),
    missedCount: String(counts.missedCount),
    totalCount: String(totalCount),
    message: 'balance resolution committed; ready for TERMINATE',
  };
}

/**
 * Emit the REVEAL info log for BALANCE-RESOLVE.final.
 * @param input - Pipeline context.
 * @param totalCount - Number of accounts in the extracted map.
 * @returns True after the log is emitted.
 */
function emitFinalReveal(input: IPipelineContext, totalCount: number): true {
  const counts = readFinalRevealCounts(input);
  const diag = buildFinalRevealDiag(counts, totalCount);
  LOG.info(diag);
  return true;
}

/**
 * BALANCE-RESOLVE.final — collapse the extracted outcomes to a final
 * number map. 'MISS' entries become 0; legitimate zero balances are
 * preserved.
 * @param input - Pipeline context.
 * @returns Updated context with balanceResolution committed.
 */
function executeBalanceResolveFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const extracted = input.balanceExtracted.has ? input.balanceExtracted.value : EMPTY_EXTRACTED;
  const resolution = buildFinalMap(extracted);
  emitFinalReveal(input, extracted.size);
  const next = succeed({ ...input, balanceResolution: some(resolution) });
  return Promise.resolve(next);
}

export type { IFinalRevealDiag };
export { executeBalanceResolveFinal };
