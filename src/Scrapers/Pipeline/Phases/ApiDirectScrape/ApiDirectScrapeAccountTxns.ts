/**
 * One account's raw rows, refined into the transactions the caller asked for.
 *
 * <p>Split from ApiDirectScrapeActions so the account-assembly file stays
 * under the per-file LOC ceiling, and because this is a separable concern:
 * everything here turns provider rows into a truthful transaction list, and
 * nothing here knows how accounts are discovered or folded into a result.
 */

import type { ITransaction } from '../../../../Transactions.js';
import type { IWindowCoverage } from '../../../../WindowCoverage.js';
import { reportMapRejects } from '../../Mediator/Scrape/CoverageAudit/MapRejects.js';
import { classifyWindowCoverage } from '../../Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
import { autoMapTransaction } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyStartWindow } from '../../Mediator/Scrape/StartWindow.js';
import { collapseDuplicates } from '../../Mediator/Scrape/TxnDedup.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { collectAccountRows } from './ApiDirectScrapeBackfill.js';
import type { IAcctCtx } from './ApiDirectScrapeDispatchArgs.js';

/**
 * Map raw rows through autoMapTransaction (drops rejects).
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @param isCardIssuer - Declared by the shape; decides charge-sign handling.
 * @returns Mapped ITransactions (rejects filtered out).
 */
function mapTxns(raws: readonly object[], isCardIssuer?: boolean): readonly ITransaction[] {
  const widened = raws as unknown as readonly Record<string, unknown>[];
  const mapped = widened.map((raw): ITransaction | false => autoMapTransaction(raw, isCardIssuer));
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Map the shape's raw rows, reporting any the mapper refused.
 *
 * The refusals are reported here rather than swallowed because the shape found
 * those rows and believed them transactions — a non-zero count is data that
 * reached us and was dropped, which the totals alone would never reveal.
 *
 * @param a - Per-account context.
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @param label - Bank + step identity for the log line.
 * @returns The rows the mapper accepted.
 */
function mapAndReport<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  raws: readonly object[],
  label: string,
): readonly ITransaction[] {
  const mapped = mapTxns(raws, a.shape.isCardIssuer);
  const rejects = reportMapRejects({ extracted: raws.length, mapped: mapped.length, label });
  a.ledger.noteWhen('mappingRejectedRows', rejects.rejected > 0);
  return mapped;
}

/**
 * Refine one account's raw rows into the transactions the caller asked for.
 *
 * Reports the rows the mapper refused first, then collapses proven duplicates
 * (opt-in; no bank declares a key today) and trims to the caller's `startDate`.
 * Providers return whole billing cycles rather than a date range, so without
 * the window the caller receives months of history it never asked for.
 *
 * @param a - Per-account context.
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @returns Mapped, deduplicated, in-window transactions.
 */
function refineTxns<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  raws: readonly object[],
): readonly ITransaction[] {
  const label = `${a.ctx.companyId}/txns`;
  const mapped = mapAndReport(a, raws, label);
  const keyFields = a.shape.transactions.dedupKeyFields ?? [];
  const unique = collapseDuplicates({ txns: mapped, keyFields, label });
  return applyStartWindow({ txns: unique.kept, startDate: a.ctx.options.startDate, label }).kept;
}

/** One account's transactions plus the facts its walk produced. */
export interface IAccountTxns {
  readonly txns: readonly ITransaction[];
  /** Backfill was asked for the missing slice and did not get it. */
  readonly backfillExhausted: boolean;
  /** What this account may honestly claim about the requested window. */
  readonly windowCoverage: IWindowCoverage;
}

/**
 * Fetch + map one account's paginated transactions.
 *
 * Carries the backfill outcome out with the rows: a short window and a
 * complete one yield the same transaction list, so dropping the flag here
 * would put the loss back out of reach of every caller above.
 *
 * @param a - Per-account context.
 * @returns Mapped, in-window transactions plus the backfill outcome.
 */
export async function fetchAccountTxns<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IAccountTxns>> {
  const collected = await collectAccountRows(a);
  if (!isOk(collected)) return collected;
  const got = collected.value;
  // After refineTxns on purpose: the mapper and the de-duplicator can still
  // reject rows the walk counted, and those rejects are caveats the verdict
  // has to see. Classifying before them would publish a stale confidence.
  const txns = refineTxns(a, got.rows);
  const caveats = a.ledger.caveats();
  const windowCoverage = classifyWindowCoverage({ ...got.window, caveats });
  return succeed({ txns, backfillExhausted: got.isBackfillExhausted, windowCoverage });
}
