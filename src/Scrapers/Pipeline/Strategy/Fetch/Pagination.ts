/**
 * Generic cursor pagination helper — transport-agnostic.
 * Works for REST cursor, GraphQL cursor, page-number, offset — any cursor shape.
 * Zero bank-name coupling; driven by caller-supplied fetchPage + stop predicate.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

/** A single page of items plus the cursor for the next page (false when exhausted). */
interface IPage<TItem, TCursor> {
  readonly items: readonly TItem[];
  readonly nextCursor: TCursor | false;
}

/** Arguments for fetchPaginated — callers supply the page fetcher and stop predicate. */
interface IFetchPaginatedArgs<TItem, TCursor> {
  readonly fetchPage: (cursor: TCursor | false) => Promise<Procedure<IPage<TItem, TCursor>>>;
  readonly stop: (acc: readonly TItem[]) => boolean;
}

/** Internal recursion state — carries the accumulator and the next cursor to fetch. */
interface IPaginationState<TItem, TCursor> {
  readonly acc: readonly TItem[];
  readonly cursor: TCursor | false;
}

/**
 * Merge a fetched page into the accumulator, producing the next recursion state.
 * @param state - Current recursion state.
 * @param page - The freshly fetched page.
 * @returns The next state to hand to the recursive call.
 */
function advance<TItem, TCursor>(
  state: IPaginationState<TItem, TCursor>,
  page: IPage<TItem, TCursor>,
): IPaginationState<TItem, TCursor> {
  const mergedAcc = [...state.acc, ...page.items];
  return { acc: mergedAcc, cursor: page.nextCursor };
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
  const pageResult = await args.fetchPage(state.cursor);
  if (!isOk(pageResult)) return pageResult;
  const nextState = advance(state, pageResult.value);
  if (nextState.cursor === false) return succeed(nextState.acc);
  return paginateStep(args, nextState);
}

/**
 * Accumulate items across pages until stop predicate fires or cursor exhausts.
 * @param args - Caller-supplied fetchPage (cursor → Procedure<Page>) + stop predicate.
 * @returns Procedure carrying all accumulated items, or the first propagated fail.
 */
async function fetchPaginated<TItem, TCursor>(
  args: IFetchPaginatedArgs<TItem, TCursor>,
): Promise<Procedure<readonly TItem[]>> {
  const initial: IPaginationState<TItem, TCursor> = { acc: [], cursor: false };
  return paginateStep(args, initial);
}

export type { IFetchPaginatedArgs, IPage };
export { fetchPaginated };
export default fetchPaginated;
