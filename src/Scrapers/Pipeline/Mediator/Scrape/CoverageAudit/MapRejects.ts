/**
 * Mapper-reject counting — the blind spot its sibling guardrail cannot see.
 *
 * {@link auditCoverage} drops unmappable rows from *both* sides before it
 * compares, so a shape that extracts a hundred rows the mapper cannot read
 * scores `unread=0` and stays silent. That is correct for coverage — an
 * unmappable row is not evidence of a missing container — but it leaves the
 * opposite defect unwatched: rows the shape *did* find and the mapper then
 * discarded, which reach the caller as nothing at all.
 *
 * Unlike the hunter, a bank shape does not over-collect. It reads containers it
 * was told hold transactions, so a rejected row means either the shape claimed
 * a container it should not have, or the mapper is missing a field alias the
 * provider started sending. Both are defects; neither raises an error today.
 *
 * Measured across captured traffic for all nine pipeline banks, every one
 * scores zero. The signal is silent by default, which is the only reason it is
 * worth emitting at all.
 */

import { getDebug } from '../../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);

/** Outcome of one mapping round. Counts only — never row content. */
export interface IMapRejectResult {
  /** Rows the bank shape handed to the mapper. */
  readonly extracted: number;
  /** Rows the mapper turned into transactions. */
  readonly mapped: number;
  /** Rows the mapper refused. Above zero means data reached us and was lost. */
  readonly rejected: number;
}

/** Inputs for one mapping round. */
export interface IMapRejectArgs {
  /** Rows the bank shape handed to the mapper. */
  readonly extracted: number;
  /** Rows the mapper turned into transactions. */
  readonly mapped: number;
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/**
 * Build the one-line mapping verdict.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns Log message carrying counts only.
 */
function rejectMessage(label: string, result: IMapRejectResult): string {
  const detail = `extracted=${String(result.extracted)} mapped=${String(result.mapped)}`;
  if (result.rejected === 0) return `mapping ${label}: complete (${detail})`;
  return `mapping ${label}: UNREADABLE — rejected=${String(result.rejected)} (${detail})`;
}

/**
 * Count and report the rows the mapper refused.
 *
 * Reports only. A rejected row cannot be recovered here — the mapper already
 * decided it carries no date, amount or description it recognises, so any value
 * this layer invented for it would be a guess written into user data. The
 * repair is a reviewed change to the field aliases or to the shape's container
 * list, which is why this warns and stops.
 *
 * @param args - Row counts and log identity.
 * @returns Counts for the round.
 */
export function reportMapRejects(args: IMapRejectArgs): IMapRejectResult {
  const rejected = args.extracted - args.mapped;
  const result = { extracted: args.extracted, mapped: args.mapped, rejected };
  const message = rejectMessage(args.label, result);
  const hasRejects = rejected > 0;
  if (hasRejects) LOG.warn({ message });
  else LOG.debug({ message });
  return result;
}
