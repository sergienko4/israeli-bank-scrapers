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
 * <p>This module narrows that blind spot, but only with facts the walk can
 * actually prove. The distinction matters: an oracle that fires on healthy
 * traffic is worse than no oracle, because a warning nobody trusts is a
 * warning nobody reads.
 *
 * <p>One thing on a cursor page is provable: the newest row. A cursor is only
 * ever minted from a day that carried rows, and the next request ends on that
 * day *inclusively* — so those rows must come back, and the next page's newest
 * row must be that same day. A newest row older than the cursor means the bank
 * withheld rows between the two, which is the inverted-ordering signature. A
 * newest row *newer* than the cursor is a different fault — the bank ignored
 * the bound it was given — and is graded apart from it rather than waved
 * through.
 *
 * <p>Two things that look provable are not, and both are graded accordingly.
 *
 * <p>First, a page reaching the requested start. It is tempting to read a
 * capped page that still reaches the start as proof the cap fell at the recent
 * end. It is not: `pageWasCapped` means the page is *full*, not that rows were
 * dropped, and the cap counts rows rather than days, so the boundary can fall
 * part-way through the start day itself. A window holding 149 newer rows and
 * two rows on the start day fills a 150-row page correctly, oldest-first
 * ordering nowhere in sight. `HapoalimTxnPaging` pins that exact shape as
 * healthy. A first page therefore reports `unknown`: with no cursor to compare
 * against, a response body carries no ordering evidence at all.
 *
 * <p>Second, a cursor page whose oldest row is the cursor day. When that page
 * is *uncapped* the walk simply ends — the window held nothing older, which is
 * how a normal walk finishes. Only when the page is also full does it mean
 * something: a single day is carrying at least a whole page of rows, so the
 * next request would repeat this window unchanged. That is a completeness risk
 * worth reporting, and it is graded `stalled` rather than `violated` because
 * it does not prove the ordering inverted. `Pagination` independently halts a
 * repeated cursor, so the walk does not spin on it.
 *
 * <p>Nothing here observes the window's *recent* end directly; no response body
 * reports it. Proving that end would take a separate probe request, which is a
 * change to the fetch layer rather than to this guard, and until that exists
 * this guard narrows the gap rather than closing it.
 *
 * <p>A spurious warning costs one log line. The loss these catch cost a real
 * account four weeks of history with no error and no flag (PR #489).
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
 * `honoured` means the page's newest row is exactly the day that was asked
 * for. `violated` means the bank truncated at the recent end: the newest row
 * is older than the cursor, so rows that were proven to exist did not come
 * back. `beyond` means the page carried rows newer than the bound the request
 * gave, which honours no bound at all. `stalled` means a full page held only
 * the cursor day, so the cursor cannot advance — a completeness risk, not
 * proof of inverted ordering. `unknown` means the page proves nothing — no row
 * carried a usable date, or it was a first page, which carries no cursor to
 * compare against and so no ordering evidence.
 */
export type WalkOrderVerdict = 'honoured' | 'violated' | 'beyond' | 'stalled' | 'unknown';

/** Inputs for one ordering check. Days only — never row content. */
export interface IWalkOrderArgs {
  /** Day the request ended on (`YYYYMMDD`), or false on the first page. */
  readonly asked: string | false;
  /** Newest usable day on the page (`YYYYMMDD`), or empty when none. */
  readonly newest: string;
  /** Oldest usable day on the page (`YYYYMMDD`), or empty when none. */
  readonly oldest: string;
  /** Whether the page came back full at the bank's own stated page size. */
  readonly capped: boolean;
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
  /** Days behind a faulting verdict, rendered for the log. Empty when clean. */
  readonly detail: string;
}

/** Verdict when a page carries no evidence either way. */
const UNKNOWN: IWalkOrderResult = { verdict: 'unknown', newest: '', asked: '', detail: '' };

/**
 * Build the one-line ordering verdict.
 * @param label - Bank + step identity.
 * @param result - Days for the page.
 * @returns Log message carrying no row content.
 */
function orderMessage(label: string, result: IWalkOrderResult): string {
  const head = `walk-order ${label}`;
  if (result.detail === '') return `${head}: ${result.verdict}`;
  const shouted = result.verdict.toUpperCase();
  return `${head}: ${shouted} — ${result.detail}`;
}

/**
 * Emit the verdict. Days and the caller's label only, per
 * logging-pii-guidlines.md.
 *
 * <p>A fault warns rather than throws for the reason given in the module
 * header: the rows already gathered are worth more than the report.
 *
 * @param label - Bank + step identity.
 * @param result - Days for the page.
 * @returns The same result, so callers report and return in one step.
 */
function reportOrder(label: string, result: IWalkOrderResult): IWalkOrderResult {
  const message = orderMessage(label, result);
  const isFault = result.detail !== '';
  if (isFault) LOG.warn({ message });
  else LOG.debug({ message });
  return result;
}

/**
 * Grade a page whose newest row matched the day it asked from.
 *
 * <p>An oldest row on the cursor day is only a fault when the page is also
 * full. Uncapped, it is how a normal walk ends: nothing older was left. Full,
 * it means one day carries a whole page, so the cursor cannot move — see the
 * module header for why that is graded `stalled` and not `violated`.
 *
 * @param args - The page's days.
 * @param asked - Day the request ended on.
 * @returns Verdict plus the days compared.
 */
function gradeAdvance(args: IWalkOrderArgs, asked: string): IWalkOrderResult {
  const base = { newest: args.newest, asked };
  const didAdvance = args.oldest !== asked;
  if (didAdvance || !args.capped) return { ...base, verdict: 'honoured', detail: '' };
  const seen = `asked=${asked} oldest=${args.oldest}`;
  const stalled = `${seen}; a full page held one day, so the cursor cannot advance`;
  return { ...base, verdict: 'stalled', detail: stalled };
}

/**
 * Grade a page against the day its request asked the window to end on.
 *
 * <p>Equality is the only outcome that can be clean. The cursor was minted
 * from a day proven to carry rows and the request includes that day, so
 * anything else is the bank declining the bound in one direction or the other.
 *
 * @param args - The page's days.
 * @param asked - Day the request ended on.
 * @returns Verdict plus the days compared.
 */
function gradeCursorPage(args: IWalkOrderArgs, asked: string): IWalkOrderResult {
  if (args.newest === asked) return gradeAdvance(args, asked);
  const seen = `asked=${asked} newest=${args.newest}`;
  const base = { newest: args.newest, asked };
  const truncated = `${seen}; page truncated at its recent end`;
  if (args.newest < asked) return { ...base, verdict: 'violated', detail: truncated };
  const beyond = `${seen}; page carried rows newer than the bound it was given`;
  return { ...base, verdict: 'beyond', detail: beyond };
}

/**
 * Route the page to the grader its evidence supports.
 *
 * <p>A first page carries no cursor, and so no ordering evidence — see the
 * module header for why a capped page reaching the requested start does not
 * supply any.
 *
 * @param args - The page's days plus its fullness.
 * @returns Verdict plus the evidence behind it.
 */
function gradePage(args: IWalkOrderArgs): IWalkOrderResult {
  if (args.asked === false) return UNKNOWN;
  return gradeCursorPage(args, args.asked);
}

/**
 * Check one page against the walk's ordering assumption.
 *
 * <p>Calendar days in `YYYYMMDD` sort lexicographically, so the comparisons
 * need no date parsing.
 *
 * @param args - The page's days, its truncation evidence, and log identity.
 * @returns Verdict plus the evidence behind it.
 */
export function assessWalkOrder(args: IWalkOrderArgs): IWalkOrderResult {
  if (args.newest === '') return reportOrder(args.label, UNKNOWN);
  const graded = gradePage(args);
  return reportOrder(args.label, graded);
}
