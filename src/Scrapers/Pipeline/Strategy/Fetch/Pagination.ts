/**
 * Generic cursor pagination helper — transport-agnostic.
 * Works for REST cursor, GraphQL cursor, page-number, offset — any cursor shape.
 * Zero bank-name coupling; driven by caller-supplied fetchPage + stop predicate.
 */

import { getDebug } from '../../Logging/Debug.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

const LOG = getDebug(import.meta.url);

/**
 * Hard ceiling on pages per walk — a runaway backstop, not a budget.
 *
 * A shape derives its own cursor from the rows it just received, so a provider
 * that ignores the bound and re-serves the same page would otherwise walk for
 * ever. The cursor-repeat halt catches that exact case; this ceiling catches
 * the ones that creep — a cursor that moves by a day against an account whose
 * history outruns the window.
 *
 * Sized so it cannot fire on legitimate work, because hitting it truncates in
 * whichever direction the shape walks. Month-chunked shapes (Yahav, Max) walk
 * **oldest-first**, so a ceiling reached mid-walk drops the most RECENT months
 * — and the window guardrails would not see it, since they assert the old end
 * of the range against `startDate`. At 300 a month-chunked walk covers 25
 * years, well beyond any Israeli bank's retention, while a genuine infinite
 * loop still terminates.
 */
const MAX_PAGES = 300;

/** A single page of items plus the cursor for the next page (false when exhausted). */
interface IPage<TItem, TCursor> {
  readonly items: readonly TItem[];
  readonly nextCursor: TCursor | false;
}

/** Arguments for fetchPaginated — callers supply the page fetcher and stop predicate. */
interface IFetchPaginatedArgs<TItem, TCursor> {
  readonly fetchPage: (cursor: TCursor | false) => Promise<Procedure<IPage<TItem, TCursor>>>;
  readonly stop: (acc: readonly TItem[]) => boolean;
  /**
   * How a fetched page joins what is already held. Defaults to concatenation.
   *
   * A shape whose cursor re-asks a boundary inclusively — the only way to
   * recover rows a row-count cap withheld mid-day — receives rows it already
   * holds, and declares a merge that drops them.
   */
  readonly merge?: (held: readonly TItem[], incoming: readonly TItem[]) => readonly TItem[];
}

/** Internal recursion state — carries the accumulator, cursor and pages spent. */
interface IPaginationState<TItem, TCursor> {
  readonly acc: readonly TItem[];
  readonly cursor: TCursor | false;
  readonly page: number;
}

/**
 * Default page merge — plain concatenation.
 *
 * Exported so a caller that must supply a merge unconditionally can name this
 * one rather than reimplement it.
 *
 * @param held - Rows already accumulated.
 * @param incoming - Rows the new page carried.
 * @returns Every row, in walk order.
 */
export function concatPages<TItem>(
  held: readonly TItem[],
  incoming: readonly TItem[],
): readonly TItem[] {
  return [...held, ...incoming];
}

/**
 * Merge a fetched page into the accumulator, producing the next recursion state.
 * @param args - Caller-supplied fetchPage, stop predicate and optional merge.
 * @param state - Current recursion state.
 * @param page - The freshly fetched page.
 * @returns The next state to hand to the recursive call.
 */
function advance<TItem, TCursor>(
  args: IFetchPaginatedArgs<TItem, TCursor>,
  state: IPaginationState<TItem, TCursor>,
  page: IPage<TItem, TCursor>,
): IPaginationState<TItem, TCursor> {
  const merge = args.merge ?? concatPages;
  const mergedAcc = merge(state.acc, page.items);
  return { acc: mergedAcc, cursor: page.nextCursor, page: state.page + 1 };
}

/**
 * Whether the walk derived the cursor it just used.
 *
 * The seed cursor is `false`, meaning "none yet" rather than a value, so it can
 * never count as a repeat.
 *
 * @param next - Cursor the new page handed back.
 * @param previous - Cursor the request carried.
 * @returns True when the two are the same value.
 */
function isCursorRepeat<TCursor>(next: TCursor | false, previous: TCursor | false): boolean {
  if (previous === false) return false;
  return JSON.stringify(next) === JSON.stringify(previous);
}

/**
 * Why the walk must stop early, if it must.
 * @param next - State the fetched page produced.
 * @param state - State the request was issued under.
 * @returns Reason for the log line, or false to keep walking.
 */
function haltReason<TItem, TCursor>(
  next: IPaginationState<TItem, TCursor>,
  state: IPaginationState<TItem, TCursor>,
): string | false {
  const isRepeat = isCursorRepeat(next.cursor, state.cursor);
  if (isRepeat) return 'cursor repeated — the walk stopped making progress';
  if (next.page >= MAX_PAGES) return `page ceiling ${String(MAX_PAGES)} reached`;
  return false;
}

/**
 * Stop the walk and say so. Counts and the reason only — never row content.
 * @param acc - Rows gathered before the halt.
 * @param reason - Why the walk stopped short of an exhausted cursor.
 * @returns The rows gathered so far.
 */
function halt<TItem>(acc: readonly TItem[], reason: string): Procedure<readonly TItem[]> {
  const message = `pagination halted: ${reason} (rows=${String(acc.length)})`;
  LOG.warn({ message });
  return succeed(acc);
}

/**
 * Fetch the next page and fold it into the walk state.
 * @param args - Caller-supplied fetchPage + merge.
 * @param state - Current walk state.
 * @returns The advanced state, or the propagated fail.
 */
async function advanceOnce<TItem, TCursor>(
  args: IFetchPaginatedArgs<TItem, TCursor>,
  state: IPaginationState<TItem, TCursor>,
): Promise<Procedure<IPaginationState<TItem, TCursor>>> {
  const pageResult = await args.fetchPage(state.cursor);
  if (!isOk(pageResult)) return pageResult;
  const advanced = advance(args, state, pageResult.value);
  return succeed(advanced);
}

/**
 * The walk's final answer for this page, or false when it may take another.
 * @param next - State the fetched page produced.
 * @param state - State the request was issued under.
 * @returns The rows to return, or false to keep walking.
 */
function terminalOf<TItem, TCursor>(
  next: IPaginationState<TItem, TCursor>,
  state: IPaginationState<TItem, TCursor>,
): Procedure<readonly TItem[]> | false {
  if (next.cursor === false) return succeed(next.acc);
  const reason = haltReason(next, state);
  return reason === false ? false : halt(next.acc, reason);
}

/**
 * Recursive pagination step — fetches one page, merges, recurses or stops.
 * @param args - Caller-supplied fetchPage + stop predicate.
 * @param state - Current recursion state (accumulator + cursor).
 * @returns Procedure carrying the accumulated items, or the propagated fail.
 */
async function paginateStep<TItem, TCursor>(
  args: IFetchPaginatedArgs<TItem, TCursor>,
  state: IPaginationState<TItem, TCursor>,
): Promise<Procedure<readonly TItem[]>> {
  if (args.stop(state.acc)) return succeed(state.acc);
  const stepped = await advanceOnce(args, state);
  if (!isOk(stepped)) return stepped;
  const terminal = terminalOf(stepped.value, state);
  return terminal === false ? paginateStep(args, stepped.value) : terminal;
}

/**
 * Accumulate items across pages until stop predicate fires or cursor exhausts.
 * @param args - Caller-supplied fetchPage (cursor → Procedure<Page>) + stop predicate.
 * @returns Procedure carrying all accumulated items, or the first propagated fail.
 */
async function fetchPaginated<TItem, TCursor>(
  args: IFetchPaginatedArgs<TItem, TCursor>,
): Promise<Procedure<readonly TItem[]>> {
  const initial: IPaginationState<TItem, TCursor> = { acc: [], cursor: false, page: 0 };
  return paginateStep(args, initial);
}

export type { IFetchPaginatedArgs, IPage };
export { fetchPaginated, MAX_PAGES };
export default fetchPaginated;
