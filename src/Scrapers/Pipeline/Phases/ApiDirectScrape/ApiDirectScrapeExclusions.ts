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
 * Report how many discovered products a shape's filter excluded.
 *
 * <p>Only a non-zero exclusion is worth a line — reporting on every clean run
 * would train operators to ignore it. Counts ONLY: account ids, numbers and
 * product categories never reach the log (`logging-pii-guidlines.md`).
 * @param d - Driver context.
 * @param args - The bundle handed to the shape's extractor.
 * @param selected - How many accounts the extractor kept.
 * @returns How many products were excluded.
 */
export default function reportExcludedProducts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  args: IExtractAccountsArgs,
  selected: number,
): ExcludedProductCount {
  const count = d.shape.customer.countDiscovered;
  if (!count) return 0 as ExcludedProductCount;
  const discovered = count(args);
  const counts = { discovered, selected, excluded: discovered - selected };
  if (counts.excluded <= 0) return 0 as ExcludedProductCount;
  return logExclusion(d, counts) as ExcludedProductCount;
}
