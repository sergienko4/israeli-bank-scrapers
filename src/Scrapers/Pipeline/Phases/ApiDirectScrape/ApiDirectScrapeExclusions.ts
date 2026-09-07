/**
 * Reporting for products a shape excludes at discovery (issue #550).
 *
 * <p>A shape may decline to walk a product it knows the transactions resolver
 * cannot serve — Pepper's non-`Ils` products are the motivating case. That is
 * the right call: attempting them aborts the whole scrape. But an exclusion is
 * a SILENT omission of money unless an operator can see it happened, so any
 * shape that filters must also declare `customer.countDiscovered`, and the
 * driver reports the delta here.
 *
 * <p>Shapes that declare no `countDiscovered` filter nothing and emit nothing,
 * which is why the other api-direct banks sharing this driver are unaffected.
 */

import type { Brand } from '../../Types/Brand.js';
import { toError } from '../../Types/ErrorUtils.js';
import type { IDriverCtx } from './ApiDirectScrapeDispatchArgs.js';
import type { IExtractAccountsArgs } from './IApiDirectScrapeShape.js';

/** Count of products a shape excluded at discovery — branded for Rule #15. */
type ExcludedProductCount = Brand<number, 'ExcludedProductCount'>;

/**
 * Log message reporting products a shape excluded at discovery.
 *
 * <p>Exported so specs assert the exact production string rather than
 * re-declaring it and drifting.
 */
export const ACCOUNTS_FILTERED_LOG = 'api-direct-scrape.accounts.filtered';

/**
 * Log message reporting a FAILURE of the exclusion report itself.
 *
 * <p>Contained is not the same as hidden: swallowing the throw keeps a
 * healthy scrape alive, but a diagnostics channel that has stopped working
 * is itself an operational fact an operator has to be able to see.
 */
export const EXCLUSION_REPORT_FAILED = 'api-direct-scrape.accounts.filtered.failed';

/** Counts describing one filtered discovery pass. */
interface IExclusionCounts {
  readonly discovered: number;
  readonly selected: number;
  readonly excluded: number;
}

/**
 * Emit the exclusion report line.
 * @param d - Driver context.
 * @param counts - Discovered / kept / excluded totals.
 * @returns How many products were excluded.
 */
function logExclusion<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  counts: IExclusionCounts,
): number {
  d.ctx.logger.info({ message: ACCOUNTS_FILTERED_LOG, ...counts });
  return counts.excluded;
}

/**
 * Compute the exclusion delta and log it when it is non-zero.
 * @param d - Driver context.
 * @param args - The bundle handed to the shape's extractor.
 * @param selected - How many accounts the extractor kept.
 * @returns How many products were excluded.
 */
function computeExclusion<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  args: IExtractAccountsArgs,
  selected: number,
): number {
  const count = d.shape.customer.countDiscovered;
  if (!count) return 0;
  const discovered = count(args);
  const counts = { discovered, selected, excluded: discovered - selected };
  if (counts.excluded <= 0) return 0;
  return logExclusion(d, counts);
}

/**
 * Report how many discovered products a shape's filter excluded.
 *
 * <p>TOTAL BY CONSTRUCTION — it reports, so it must never decide. A shape's
 * `countDiscovered` is arbitrary bank-specific code that can throw; letting
 * that escape would discard a scrape that had already fetched real money,
 * turning an observability defect into data loss. The throw is contained
 * here and re-surfaced as a warning instead.
 *
 * <p>Only a non-zero exclusion is worth a line — reporting on every clean run
 * would train operators to ignore it. The report carries counts ONLY: account
 * ids, numbers and product categories never reach the log
 * (`logging-pii-guidlines.md`).
 * @param d - Driver context.
 * @param args - The bundle handed to the shape's extractor.
 * @param selected - How many accounts the extractor kept.
 * @returns How many products were excluded; `0` if reporting itself failed.
 */
export default function reportExcludedProducts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  args: IExtractAccountsArgs,
  selected: number,
): ExcludedProductCount {
  try {
    return computeExclusion(d, args, selected) as ExcludedProductCount;
  } catch (error) {
    const reason = toError(error).message;
    d.ctx.logger.warn({ message: EXCLUSION_REPORT_FAILED, reason });
    return 0 as ExcludedProductCount;
  }
}
