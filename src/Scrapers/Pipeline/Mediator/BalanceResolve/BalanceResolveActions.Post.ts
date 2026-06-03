/**
 * BalanceResolveActions.Post — POST orchestrator + partition helpers.
 * Extracted from the BalanceResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import { redactAccount } from '../../Types/PiiRedactor.js';
import type {
  IBalanceExtracted,
  IBalanceValidation,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { EMPTY_EXTRACTED } from './BalanceResolveActions.Shared.js';

/**
 * Partition the extracted outcomes into resolved (finite) and missed.
 * @param extracted - Extracted outcomes per accountId.
 * @returns Validation report.
 */
function partitionOutcomes(extracted: IBalanceExtracted): IBalanceValidation {
  const entries = [...extracted.entries()];
  const missed = entries.filter(([, outcome]): boolean => outcome === 'MISS');
  const resolved = entries.filter(([, outcome]): boolean => outcome !== 'MISS');
  return {
    resolvedIds: resolved.map(([id]): string => id),
    missedIds: missed.map(([id]): string => id),
    totalAccounts: extracted.size,
  };
}

/**
 * Emit a per-account 'balance.miss' warn for each missed accountId.
 * @param missedIds - Account ids with no balance found.
 * @param log - Pipeline logger.
 * @returns Number of warns emitted.
 */
function emitMissWarns(missedIds: readonly string[], log: IPipelineContext['logger']): number {
  for (const accountId of missedIds) {
    log.warn({
      event: 'balance.miss',
      account: redactAccount(accountId),
      message: 'balance unresolved — fallback to 0',
    });
  }
  return missedIds.length;
}

/**
 * Detect the universal-miss POST condition.
 * @param report - Partitioned outcome from {@link partitionOutcomes}.
 * @returns True when every account missed.
 */
function isUniversalMiss(report: IBalanceValidation): boolean {
  return report.totalAccounts > 0 && report.missedIds.length === report.totalAccounts;
}

/**
 * Emit the `balance-resolve.post` debug summary.
 * @param log - Pipeline logger sink.
 * @param report - Partitioned validation report.
 * @returns Always true (sentinel for callers).
 */
function emitPostSummary(log: IPipelineContext['logger'], report: IBalanceValidation): true {
  const message =
    `balance-resolve.post resolved=${String(report.resolvedIds.length)} ` +
    `missed=${String(report.missedIds.length)} total=${String(report.totalAccounts)}`;
  log.debug({ message });
  return true;
}

/**
 * Build the universal-miss failure procedure for BALANCE-RESOLVE.post.
 * @param report - Partitioned validation report.
 * @returns Failure procedure carrying the diagnostic message.
 */
function buildUniversalMissFailure(report: IBalanceValidation): Procedure<IPipelineContext> {
  const msg =
    `BALANCE-RESOLVE: all ${String(report.totalAccounts)} accounts unresolved — ` +
    'scrape miss (no fetch yielded a balance)';
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Pick the success / fail procedure for BALANCE-RESOLVE.post.
 * @param input - Pipeline context.
 * @param report - Partitioned validation report.
 * @returns Failure for universal-miss, otherwise the commit success.
 */
function chooseBalancePostOutcome(
  input: IPipelineContext,
  report: IBalanceValidation,
): Procedure<IPipelineContext> {
  if (isUniversalMiss(report)) return buildUniversalMissFailure(report);
  return succeed({ ...input, balanceValidation: some(report) });
}

/**
 * BALANCE-RESOLVE.post — partition outcomes into resolved vs missed.
 * @param input - Pipeline context.
 * @returns Updated context, or fail on universal miss.
 */
function executeBalanceResolvePost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const extracted = input.balanceExtracted.has ? input.balanceExtracted.value : EMPTY_EXTRACTED;
  const report = partitionOutcomes(extracted);
  emitMissWarns(report.missedIds, input.logger);
  emitPostSummary(input.logger, report);
  const outcome = chooseBalancePostOutcome(input, report);
  return Promise.resolve(outcome);
}

export type { IBalanceValidation as IBalancePostReport };
export { executeBalanceResolvePost };
