/**
 * Ordering guard for the Hapoalim backwards date-walk.
 *
 * <p>The walk in `HapoalimShapeTxns` rests on one unverified assumption, stated
 * in that module's header and encoded in the request as `sortCode=1`: when the
 * bank caps a page at its own `numItemsPerPage`, it returns the most **recent**
 * N rows of the requested window and drops the **older** remainder. The walk
 * then re-asks with the window ending on the oldest day it just saw, marching
 * backwards until the caller's start date is reached.
 *
 * <p>If that ordering ever inverted — the bank capping from the recent end
 * instead — every existing audit would still score the run perfect.
 * `assessWindowCoverage` compares the **oldest** row against the requested
 * start, so a page truncated at its recent end reaches the start date and is
 * graded `covered`. The coverage audit asks whether every row in the body was
 * read, and it was. Nothing anywhere inspects the window's recent end, so the
 * loss would land exactly where no guard is looking.
 *
 * <p>This module closes that blind spot with a fact the walk already proved.
 * A cursor is only ever minted from a day that carried rows, and the next
 * request ends on that day *inclusively* — so the next page's newest row must
 * be that same day. A newest row older than the cursor means the bank withheld
 * rows between the two, which is the inverted-ordering signature.
 *
 * <p>It reports and never repairs, matching `WindowCoverage`. Throwing would
 * discard the rows already gathered, which is a larger loss than the one being
 * reported.
 */

import { getDebug } from '../../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);

/**
 * Whether a page honoured the ordering the walk depends on.
 *
 * `honoured` means the page's newest row is the day that was asked for.
 * `violated` means it is older, so rows between them were withheld.
 * `unknown` means the page proves nothing — the first page of a walk, or a
 * page on which no row carried a usable date.
 */
export type WalkOrderVerdict = 'honoured' | 'violated' | 'unknown';

/** Inputs for one ordering check. Days only — never row content. */
export interface IWalkOrderArgs {
  /** Day the request ended on (`YYYYMMDD`), or false on the first page. */
  readonly asked: string | false;
  /** Newest usable day on the page (`YYYYMMDD`), or empty when none. */
  readonly newest: string;
  /** Bank + step identity for the log line. */
  readonly label: string;
}

/** Outcome of one ordering check. */
export interface IWalkOrderResult {
  /** Whether the page honoured the walk's ordering assumption. */
  readonly verdict: WalkOrderVerdict;
  /** Newest day the page carried, or empty when none was usable. */
  readonly newest: string;
  /** Day the request asked the window to end on, or empty on the first page. */
  readonly asked: string;
}

/** Verdict when a page carries no evidence either way. */
const UNKNOWN: IWalkOrderResult = { verdict: 'unknown', newest: '', asked: '' };

/**
 * Build the one-line ordering verdict.
 * @param label - Bank + step identity.
 * @param result - Days for the page.
 * @returns Log message carrying no row content.
 */
function orderMessage(label: string, result: IWalkOrderResult): string {
  if (result.verdict !== 'violated') return `walk-order ${label}: ${result.verdict}`;
  const seen = `asked=${result.asked} newest=${result.newest}`;
  return `walk-order ${label}: VIOLATED — ${seen}; page truncated at its recent end`;
}

/**
 * Emit the verdict. Days and the caller's label only, per
 * logging-pii-guidlines.md.
 *
 * <p>`violated` warns rather than throws for the reason given in the module
 * header: the rows already gathered are worth more than the report.
 *
 * @param label - Bank + step identity.
 * @param result - Days for the page.
 * @returns The same result, so callers report and return in one step.
 */
function reportOrder(label: string, result: IWalkOrderResult): IWalkOrderResult {
  const message = orderMessage(label, result);
  if (result.verdict === 'violated') LOG.warn({ message });
  else LOG.debug({ message });
  return result;
}

/**
 * Check one page against the day its request asked the window to end on.
 *
 * <p>Calendar days in `YYYYMMDD` sort lexicographically, so the comparison
 * needs no date parsing.
 *
 * @param args - Asked day, the page's newest day, and log identity.
 * @returns Verdict plus the two days compared.
 */
export function assessWalkOrder(args: IWalkOrderArgs): IWalkOrderResult {
  if (args.asked === false || args.newest === '') return reportOrder(args.label, UNKNOWN);
  const isHonoured = args.newest >= args.asked;
  const verdict: WalkOrderVerdict = isHonoured ? 'honoured' : 'violated';
  return reportOrder(args.label, { verdict, newest: args.newest, asked: args.asked });
}
