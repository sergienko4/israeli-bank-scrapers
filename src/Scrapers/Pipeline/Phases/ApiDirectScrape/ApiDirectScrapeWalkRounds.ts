/**
 * One round of the ApiDirectScrape transactions walk: request under a bound,
 * then assess what the rows held prove.
 *
 * <p>A round issues the paginated request for the account's current upper bound
 * and hands the result to the window-coverage audit and the backfill planner.
 * The loop that decides whether to ask again lives in
 * ApiDirectScrapeBackfill.ts; this file owns what a single round does. Split out
 * of ApiDirectScrapeBackfill.ts to keep both files under the per-file LOC
 * ceiling. It holds no bank knowledge — the stance comes from the shape's
 * declaration and every decision comes from {@link planBackfill}.
 *
 * <p>The assessment lives here rather than beside the mapping step because its
 * unit is the account, not the page: a bank that walks month by month returns
 * an August page that cannot reach a February start, so asking per page warns
 * on almost every page of every card issuer by construction. It runs on the
 * raw rows, before the start-window trims them — assessing the trimmed set
 * would be circular, since trimming is precisely what guarantees nothing
 * predates the start.
 */

import { worseTermination } from '../../Mediator/Scrape/CoverageAudit/TerminationEvidence.js';
import type { IWindowResult } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { assessWindowCoverage } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import type { PageMerge } from '../../Mediator/Scrape/OverlapMerge.js';
import { buildOverlapMerge } from '../../Mediator/Scrape/OverlapMerge.js';
import { dropOverlap } from '../../Mediator/Scrape/RawOverlap.js';
import type { IBackfillPlan } from '../../Mediator/Scrape/WindowBackfill.js';
import { planBackfill } from '../../Mediator/Scrape/WindowBackfill.js';
import type { IPaginatedWalk, PaginationTermination } from '../../Strategy/Fetch/Pagination.js';
import { concatPages, fetchPaginated } from '../../Strategy/Fetch/Pagination.js';
import type { Option } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { buildPageFetcher, buildStop } from './ApiDirectScrapeSteps.js';
import type { IAcctCtx } from './ApiDirectScrapeTypes.js';
import { guardShapeProcedure } from './ShapeGuard.js';

/** Everything one account has collected, and under which bound. */
export interface IWalkState {
  /** Raw rows held so far, in arrival order. */
  readonly rows: readonly object[];
  /** Upper bound the most recent request carried. */
  readonly end: Option<Date>;
  /** Extra requests issued beyond the first. */
  readonly attempt: number;
  /**
   * How pagination ended, the most doubtful round winning.
   *
   * <p>Monotonic on purpose. Each backfill round runs its own paginated walk,
   * so keeping only the newest answer would let a clean final round erase an
   * earlier halt — the walk would look exhausted when an earlier round had
   * already proved it was not.
   *
   * <p>Ranked by `worseTermination`, which shares its ordering with
   * `isLossyTermination` so that "which ending is worse" and "which endings
   * are loss" cannot drift apart. They did once: the fold kept the first
   * non-`exhausted` answer, so an early `predicateStop` — which is not loss —
   * masked a `cursorRepeat` a later round went on to prove.
   */
  readonly termination: PaginationTermination;
}

/** One round of the walk: what the rows prove, and what to do next. */
export interface IRound {
  /** The start the caller asked for, as the audit read it. */
  readonly requestedStart: string;
  /** Verdict for everything held at the start of this round. */
  readonly coverage: IWindowResult;
  /** What the planner decided to do about it. */
  readonly plan: IBackfillPlan;
}

/**
 * The correlation identity for one account's transactions walk.
 *
 * The paginator's overlap collapse, the window-coverage assessment and the
 * backfill plan each log under this exact string — it is what ties those three
 * lines together when reading a run, so it is derived once rather than spelled
 * out at each site where a drifting copy would break the correlation.
 *
 * @param a - Per-account context.
 * @returns Bank and step identity. Carries no account or row content.
 */
function labelOf<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): string {
  return `${a.ctx.companyId}/txns`;
}

/**
 * Page merge for this account's walk.
 *
 * Bound to the account's label so the collapse reports under the same identity
 * as the rest of the walk. A shape that declares nothing keeps plain
 * concatenation, which is correct for disjoint pages and costs nothing.
 *
 * @param a - Per-account context.
 * @returns The merge the paginator should join pages with.
 */
function buildMerge<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): PageMerge {
  if (a.shape.transactions.pagesMayOverlap !== true) return concatPages;
  const label = labelOf(a);
  return buildOverlapMerge(label);
}

/**
 * Run one full paginated transactions walk under the context's current bound.
 * @param a - Per-account context.
 * @returns Every raw row that walk produced.
 */
export async function fetchOnce<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IPaginatedWalk<object>>> {
  const fetchPage = buildPageFetcher(a);
  const stop = buildStop(a);
  const merge = buildMerge(a);
  return fetchPaginated<object, TCursor>({ fetchPage, stop, merge });
}

/**
 * Whether the caller supplied a resolved requested-start instant.
 * @param start - Requested lower-bound instant.
 * @returns True when the instant can guide pagination.
 */
function startIsReadable(start: Date): boolean {
  const time = start.getTime();
  return Number.isFinite(time);
}

/**
 * Build the empty walk used when caller input cannot safely reach a provider.
 * @returns Caller-stopped walk with no fabricated rows.
 */
function unreadableStartWalk(): Procedure<IPaginatedWalk<object>> {
  return succeed({ items: [], termination: 'predicateStop' });
}

/**
 * Select the bounded initial fetch from requested-start readability.
 * @param a - Per-account context.
 * @returns One page for an unreadable start, otherwise the normal walk.
 */
export function fetchInitial<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IPaginatedWalk<object>>> {
  if (!startIsReadable(a.ctx.options.startDate)) {
    const walk = unreadableStartWalk();
    return Promise.resolve(walk);
  }
  return fetchOnce(a);
}

/**
 * Run the shape's optional whole-plan guard for a readable request.
 * @param a - Per-account context carrying the shape and requested window.
 * @returns Successful validation, or the shape's typed rejection.
 */
export function validateRequestPlan<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): Procedure<void> {
  if (!startIsReadable(a.ctx.options.startDate)) return succeed(undefined);
  const validate = a.shape.transactions.validatePlan;
  if (!validate) return succeed(undefined);
  return guardShapeProcedure('transactions.validatePlan', () => validate(a.ctx));
}

/**
 * Fold one narrowed response's fresh rows into the walk state.
 * @param a - Per-account context.
 * @param state - Rows held, plus the bound the response was asked under.
 * @param page - The response's page.
 * @returns The extended state.
 */
function extendedState<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
  page: IPaginatedWalk<object>,
): Procedure<IWalkState> {
  const fresh = dropOverlap({ collected: state.rows, incoming: page.items, label: labelOf(a) });
  const rows = [...state.rows, ...fresh.kept];
  const termination = worseTermination(state.termination, page.termination);
  return succeed({ rows, end: state.end, attempt: state.attempt + 1, termination });
}

/**
 * Issue one narrowed request and fold its fresh rows into the state.
 * @param a - Per-account context.
 * @param state - Rows held, plus the bound the next request should carry.
 * @returns The extended state.
 */
export async function extend<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
): Promise<Procedure<IWalkState>> {
  const more = await fetchOnce({ ...a, ctx: { ...a.ctx, windowEnd: state.end } });
  if (!isOk(more)) return more;
  return extendedState(a, state, more.value);
}

/**
 * Render a requested start for the audit without ever throwing.
 *
 * <p>`toISOString` throws on an unparseable date, which would abort the whole
 * account before the coverage verdict could say so. A caller who passed a bad
 * start deserves to be told that in the result, not by losing the account.
 *
 * @param start - The start the caller supplied.
 * @returns An ISO instant, or a marker the audit will reject as unreadable.
 */
function renderStart(start: Date): string {
  return startIsReadable(start) ? start.toISOString() : 'invalid-date';
}

/**
 * Decide whether the window is already covered, and under what bound to re-ask.
 *
 * Returns the coverage verdict alongside the plan because the walk needs both:
 * the plan to decide whether to continue, the verdict to record why it stopped.
 * Re-deriving the verdict at the stop site would emit the audit's log line a
 * second time and break the one-line-per-round correlation.
 *
 * @param a - Per-account context.
 * @param state - Rows held and the bound that produced them.
 * @returns The coverage verdict and the backfill plan for this round.
 */
export function planFor<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, state: IWalkState): IRound {
  const label = labelOf(a);
  const requestedStart = renderStart(a.ctx.options.startDate);
  const coverage = assessWindowCoverage({ requestedStart, rows: state.rows, label });
  const spent = { attempt: state.attempt, previousEnd: state.end };
  const stance = a.shape.transactions.windowNarrowing;
  const plan = planBackfill({ stance, coverage, label, ...spent });
  return { requestedStart, coverage, plan };
}
