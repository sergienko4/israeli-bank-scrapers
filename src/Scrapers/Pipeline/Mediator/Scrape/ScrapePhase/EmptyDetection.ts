/**
 * EmptyDetection — sanity-gate + zero-amount audit helpers for
 * SCRAPE.POST.
 *
 * Individual 0-txn accounts are legitimate (dormant cards, just-
 * issued cards, accounts with no activity in the 180-day window).
 * But when EVERY account in the scrape result has 0 txns, that's
 * not a real bank state — it's a silent scrape miss. The
 * capture-pool heuristic separates the two cases.
 *
 * Extracted from ScrapePhaseActions.ts in Phase 8.5b C4.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import { fail, type Procedure } from '../../../Types/Procedure.js';

/** Heuristic verdict returned by {@link checkScrapeMissHeuristic}. */
interface IScrapeMissVerdict {
  readonly isMiss: boolean;
  readonly poolSize: number;
  readonly successCount: number;
}

/** Telemetry counters bundle accepted by {@link emitRealEmptyAccepted}. */
interface IRealEmptyCounters {
  readonly accountCount: number;
  readonly poolSize: number;
  readonly successCount: number;
  readonly isMiss?: boolean;
}

/** Transaction amount fields for zero-check. */
interface IAmountFields {
  readonly chargedAmount: number;
  readonly originalAmount: number;
}

/** Zero-amount audit result. */
interface IZeroAudit {
  readonly total: number;
  readonly zeros: number;
}

/**
 * Check if a transaction has zero charged AND original.
 * @param txn - Transaction amount fields.
 * @returns True if both amounts are zero.
 */
function isZeroAmountTxn(txn: IAmountFields): boolean {
  return txn.chargedAmount === 0 && txn.originalAmount === 0;
}

/**
 * Count zero-amount transactions across all accounts.
 * @param accounts - Scraped accounts.
 * @returns Total txn count and zero-amount count.
 */
function countZeroAmounts(accounts: readonly { txns: readonly IAmountFields[] }[]): IZeroAudit {
  const allTxns = accounts.flatMap((a): readonly IAmountFields[] => a.txns);
  const zeros = allTxns.filter(isZeroAmountTxn).length;
  return { total: allTxns.length, zeros };
}

/**
 * Predicate: should we warn that ALL transactions are zero?
 * Hoisted to keep {@link warnZeroAmounts} ≤10 eff.
 *
 * @param audit - Zero-amount audit result.
 * @returns True when total > 0 and every txn is zero.
 */
function shouldWarnAllZero(audit: IZeroAudit): boolean {
  return audit.total > 0 && audit.zeros === audit.total;
}

/**
 * Warn if all transaction amounts are 0.00 — diagnostic, not failure.
 * Returns true only when a warning was actually emitted (all txns zero);
 * the no-op branches (no scrape, empty accounts, mixed amounts) return
 * false so the function carries semantic information instead of always
 * yielding the same sentinel.
 *
 * @param input - Pipeline context after scraping.
 * @returns True when the all-zero warning fired.
 */
function warnZeroAmounts(input: IPipelineContext): boolean {
  if (!input.scrape.has) return false;
  const accounts = input.scrape.value.accounts;
  if (accounts.length === 0) return false;
  const audit = countZeroAmounts(accounts);
  if (!shouldWarnAllZero(audit)) return false;
  input.logger.warn({ message: `ALL ${String(audit.total)} transactions have 0.00 amounts` });
  return true;
}

/**
 * Hard sanity gate input: returns true ONLY when there's at least one
 * account but every account has zero txns. The 0-accounts case is a
 * different failure mode handled elsewhere.
 *
 * @param input - Pipeline context after scraping.
 * @returns True when all-accounts-empty sanity violation detected.
 */
function isAllAccountsEmpty(input: IPipelineContext): boolean {
  if (!input.scrape.has) return false;
  const accounts = input.scrape.value.accounts;
  if (accounts.length === 0) return false;
  const hasAnyTxn = accounts.some((a): boolean => a.txns.length > 0);
  return !hasAnyTxn;
}

/**
 * v4 Issue 2 — capture-pool heuristic. Inspects scrapeDiscovery +
 * mediator state to decide whether the empty-result state is more
 * likely a scrape miss than a legitimate "no activity in window".
 *
 * @param input - Pipeline context after scraping.
 * @returns Verdict + counters.
 */
function checkScrapeMissHeuristic(input: IPipelineContext): IScrapeMissVerdict {
  if (!input.scrapeDiscovery.has || !input.mediator.has) {
    return { isMiss: true, poolSize: 0, successCount: 0 };
  }
  const poolSize = input.scrapeDiscovery.value.frozenEndpoints?.length ?? 0;
  if (poolSize === 0) return { isMiss: true, poolSize: 0, successCount: 0 };
  const successCount = input.mediator.value.network.countSuccessfulResponses();
  return { isMiss: successCount === 0, poolSize, successCount };
}

/**
 * Emit the structured info log when SCRAPE.POST accepts an empty
 * result as legitimate (prod consumers with no activity in window).
 * Counters only — zero PII surface.
 *
 * @param input - Pipeline context.
 * @param counters - Account / pool / success counters bundle.
 * @returns True after the log is emitted.
 */
function emitRealEmptyAccepted(input: IPipelineContext, counters: IRealEmptyCounters): true {
  input.logger.info({
    event: 'scrape.empty-result-accepted',
    accountCount: String(counters.accountCount),
    poolSize: String(counters.poolSize),
    successCount: String(counters.successCount),
    message: 'all accounts returned 0 txns; pool + responses OK — real empty state',
  });
  return true;
}

/**
 * Build the structured fail Procedure when every account ended up
 * empty AND the heuristic flagged a scrape miss.
 *
 * @param countStr - String form of account count for the message.
 * @returns Terminal Procedure carrying the fail outcome.
 */
function failOnEmptyAllAccounts(countStr: string): Procedure<IPipelineContext> {
  const errMsg =
    `scrape.post: all ${countStr} accounts have 0 txns AND ` +
    'scrape miss heuristic flagged — fail';
  return fail(ScraperErrorTypes.Generic, errMsg);
}

/** Args bundle for {@link gateEmptyOutcome} — keeps ≤3-param cap satisfied. */
interface IGateOutcomeArgs {
  readonly input: IPipelineContext;
  readonly countStr: string;
  readonly accountCount: number;
  readonly verdict: IScrapeMissVerdict;
}

/**
 * Branch on the heuristic verdict: fail when miss, accept-empty when
 * real. Hoisted out of {@link decideEmptyGate} so that function stays
 * ≤10 eff.
 *
 * @param args - Bundled input / counters / verdict.
 * @returns Terminal Procedure when miss; false to continue otherwise.
 */
function gateEmptyOutcome(args: IGateOutcomeArgs): Procedure<IPipelineContext> | false {
  if (args.verdict.isMiss) return failOnEmptyAllAccounts(args.countStr);
  emitRealEmptyAccepted(args.input, { accountCount: args.accountCount, ...args.verdict });
  return false;
}

/**
 * Decide whether SCRAPE.POST should hard-fail because every account
 * landed with 0 txns.
 *
 * @param input - Pipeline context.
 * @param countStr - String form of account count for the message.
 * @param accountCount - Account count integer for telemetry.
 * @returns Decision: false to continue, or a terminal Procedure.
 */
function decideEmptyGate(
  input: IPipelineContext,
  countStr: string,
  accountCount: number,
): Procedure<IPipelineContext> | false {
  if (!isAllAccountsEmpty(input)) return false;
  const verdict = checkScrapeMissHeuristic(input);
  return gateEmptyOutcome({ input, countStr, accountCount, verdict });
}

// Re-export `succeed` is intentionally NOT included — this module only
// branches via `fail` and a literal `false` sentinel.
export { decideEmptyGate, warnZeroAmounts };
