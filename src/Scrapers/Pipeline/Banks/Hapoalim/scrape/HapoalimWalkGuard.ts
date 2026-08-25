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
 * <p>This module closes that blind spot with facts the walk already proved.
 *
 * <p>On a page that carried a cursor, two separate things are checked.
 *
 * <p>First, the newest row. A cursor is only ever minted from a day that
 * carried rows, and the next request ends on that day *inclusively* — so the
 * next page's newest row must be that same day. A newest row older than the
 * cursor means the bank withheld rows between the two, which is the
 * inverted-ordering signature. A newest row *newer* than the cursor is a
 * different fault — the bank ignored the bound it was given — and is graded
 * apart from it rather than waved through.
 *
 * <p>Second, whether the walk advanced. A cursor page always follows a capped
 * one, so rows were known to exist *below* the cursor day. Under the assumed
 * ordering this page must therefore reach below it. A page whose oldest row is
 * the cursor day itself did not: the next request would repeat this exact
 * window. That is what inversion looks like from page two — the bank keeps
 * returning the oldest slice, so the cursor never moves — and it is the
 * detection that does not depend on which day the caller asked to start from.
 *
 * <p>On the first page there is no cursor. A page capped at the bank's own
 * limit asserts that more rows existed than were returned, and under the
 * assumed ordering a cap drops the *oldest* of them — so a capped page cannot
 * also reach back to the requested start. Reaching it means the cap fell at
 * the recent end instead.
 *
 * <p>Two limits on that first-page test are worth stating plainly, because it
 * reads stronger than it is. It misfires for an account whose entire window
 * holds exactly the cap's worth of rows, which is indistinguishable from a
 * truncated one since the bank states only the page size it applied. And it
 * stays silent far more often than it fires: the request is bounded at the
 * requested start, so no row can predate it, and the test therefore needs the
 * account to hold a transaction on that exact calendar day. An account whose
 * earliest row in the window falls even one day later reports `unknown` here
 * and is caught on the next page by the stalled-cursor test above instead.
 *
 * <p>Neither test observes the window's *recent* end directly; nothing in a
 * response body does. Proving that end would take a separate probe request,
 * which is a change to the fetch layer rather than to this guard.
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
 * for. `violated` means the bank truncated at the recent end — either the
 * newest row is older than the cursor, or a capped first page reached back to
 * the requested start. `beyond` means the page carried rows newer than the
 * bound the request gave, which honours no bound at all. `unknown` means the
 * page proves nothing — no row carried a usable date, or a first page offered
 * no truncation evidence.
 */
export type WalkOrderVerdict = 'honoured' | 'violated' | 'beyond' | 'unknown';

/** Inputs for one ordering check. Days only — never row content. */
export interface IWalkOrderArgs {
  /** Day the request ended on (`YYYYMMDD`), or false on the first page. */
  readonly asked: string | false;
  /** Newest usable day on the page (`YYYYMMDD`), or empty when none. */
  readonly newest: string;
  /** Oldest usable day on the page (`YYYYMMDD`), or empty when none. */
  readonly oldest: string;
  /** Whether the bank truncated this page at its own cap. */
  readonly capped: boolean;
  /** Day the caller asked the window to start at (`YYYYMMDD`). */
  readonly requestedStart: string;
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
 * <p>Matching the cursor is necessary but not sufficient. A cursor page always
 * follows a capped one, so rows were known to exist below the cursor day; this
 * page must reach below it or the next request repeats the same window. See
 * the module header for why a stalled cursor is inversion's page-two shape.
 *
 * @param args - The page's days.
 * @param asked - Day the request ended on.
 * @returns Verdict plus the days compared.
 */
function gradeAdvance(args: IWalkOrderArgs, asked: string): IWalkOrderResult {
  const base = { newest: args.newest, asked };
  if (args.oldest !== asked) return { ...base, verdict: 'honoured', detail: '' };
  const seen = `asked=${asked} oldest=${args.oldest}`;
  const stalled = `${seen}; page never reached below the day it asked from`;
  return { ...base, verdict: 'violated', detail: stalled };
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
 * Grade the first page, which carries no cursor to compare against.
 *
 * <p>See the module header for why "capped and yet reaching the requested
 * start" is the inversion signature, and for the one case it can misread.
 *
 * @param args - The page's days plus its truncation evidence.
 * @returns Verdict, or `unknown` when the page offers no evidence.
 */
function gradeFirstPage(args: IWalkOrderArgs): IWalkOrderResult {
  const hasReachedStart = args.oldest !== '' && args.oldest <= args.requestedStart;
  if (!args.capped || !hasReachedStart) return UNKNOWN;
  const seen = `oldest=${args.oldest} start=${args.requestedStart}`;
  const detail = `${seen}; a capped page cannot also reach the requested start`;
  return { verdict: 'violated', newest: args.newest, asked: '', detail };
}

/**
 * Route the page to the grader its evidence supports.
 * @param args - The page's days plus its truncation evidence.
 * @returns Verdict plus the evidence behind it.
 */
function gradePage(args: IWalkOrderArgs): IWalkOrderResult {
  if (args.asked === false) return gradeFirstPage(args);
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
