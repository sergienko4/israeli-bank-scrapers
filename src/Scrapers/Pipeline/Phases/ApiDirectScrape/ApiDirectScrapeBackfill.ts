/**
 * Per-account row collection — the first request plus any backfill it earns.
 *
 * The window-coverage audit can say "the rows do not reach back to the start",
 * and for eight of the sixteen banks that shortfall is answerable: narrow the
 * upper bound to just before the oldest row held and ask again. This file owns
 * that loop. It holds no bank knowledge — the stance comes from the shape's
 * declaration and every decision comes from {@link planBackfill}.
 *
 * The assessment lives here rather than beside the mapping step because its
 * unit is the account, not the page: a bank that walks month by month returns
 * an August page that cannot reach a February start, so asking per page warns
 * on almost every page of every card issuer by construction. It runs on the
 * raw rows, before the start-window trims them — assessing the trimmed set
 * would be circular, since trimming is precisely what guarantees nothing
 * predates the start.
 */

import type { IWindowResult } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { assessWindowCoverage } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import type { PageMerge } from '../../Mediator/Scrape/OverlapMerge.js';
import { buildOverlapMerge } from '../../Mediator/Scrape/OverlapMerge.js';
import { dropOverlap } from '../../Mediator/Scrape/RawOverlap.js';
import type { IBackfillPlan } from '../../Mediator/Scrape/WindowBackfill.js';
import { planBackfill } from '../../Mediator/Scrape/WindowBackfill.js';
import { concatPages, fetchPaginated } from '../../Strategy/Fetch/Pagination.js';
import type { Option } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IAcctCtx } from './ApiDirectScrapeDispatchArgs.js';
import { buildPageFetcher, buildStop } from './ApiDirectScrapeSteps.js';

/** Everything one account has collected, and under which bound. */
interface IWalkState {
  /** Raw rows held so far, in arrival order. */
  readonly rows: readonly object[];
  /** Upper bound the most recent request carried. */
  readonly end: Option<Date>;
  /** Extra requests issued beyond the first. */
  readonly attempt: number;
}

/**
 * One account's rows, plus whether backfill fell short of the window.
 *
 * <p>The rows alone cannot carry this: a truncated result and a complete one
 * are the same shape. Separating them is the point of the walk — the module
 * already logs "we asked and could not get more" distinctly from "we never
 * asked", and this contract makes that same distinction available to callers
 * rather than only to whoever is reading the log.
 */
export interface ICollectedRows {
  /** Raw rows from the first request and any backfill it earned. */
  readonly rows: readonly object[];
  /**
   * True when at least one backfill ask was issued and the window is still
   * not covered: the provider was asked for the missing slice and did not
   * serve it.
   *
   * <p>False when the window is covered, and — deliberately — also false when
   * no ask was ever possible: a stance that forbids backfill, a page carrying
   * no usable date, or the operator kill-switch. Those are "we never asked",
   * which is a different fact this flag does not claim. A quiet account must
   * never be reported as a truncated one.
   */
  readonly isBackfillExhausted: boolean;
}

/** One round of the walk: what the rows prove, and what to do next. */
interface IRound {
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
async function fetchOnce<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<readonly object[]>> {
  const fetchPage = buildPageFetcher(a);
  const stop = buildStop(a);
  const merge = buildMerge(a);
  return fetchPaginated<object, TCursor>({ fetchPage, stop, merge });
}

/**
 * Issue one narrowed request and fold its fresh rows into the state.
 * @param a - Per-account context.
 * @param state - Rows held, plus the bound the next request should carry.
 * @returns The extended state.
 */
async function extend<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
): Promise<Procedure<IWalkState>> {
  const more = await fetchOnce({ ...a, ctx: { ...a.ctx, windowEnd: state.end } });
  if (!isOk(more)) return more;
  const fresh = dropOverlap({ collected: state.rows, incoming: more.value, label: labelOf(a) });
  const rows = [...state.rows, ...fresh.kept];
  return succeed({ rows, end: state.end, attempt: state.attempt + 1 });
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
function planFor<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, state: IWalkState): IRound {
  const label = labelOf(a);
  const requestedStart = a.ctx.options.startDate.toISOString();
  const coverage = assessWindowCoverage({ requestedStart, rows: state.rows, label });
  const spent = { attempt: state.attempt, previousEnd: state.end };
  const stance = a.shape.transactions.windowNarrowing;
  const plan = planBackfill({ stance, coverage, label, ...spent });
  return { coverage, plan };
}

/**
 * Close the walk, recording whether backfill was spent without covering.
 *
 * Both conditions are required. A short window that was never asked about is
 * not exhaustion, and a covered window is not short however many asks it took.
 *
 * @param state - Rows held and the asks spent reaching them.
 * @param coverage - Verdict for those rows.
 * @returns The account's rows plus the exhaustion fact.
 */
function stopAt(state: IWalkState, coverage: IWindowResult): ICollectedRows {
  const didAsk = state.attempt > 0;
  const isShort = coverage.verdict !== 'covered';
  return { rows: state.rows, isBackfillExhausted: didAsk && isShort };
}

/** What one walk round settles on, named to keep the recursive signature short. */
type WalkOutcome = Promise<Procedure<ICollectedRows>>;

/**
 * Assess what is held, then either stop or narrow the bound and ask again.
 * @param a - Per-account context.
 * @param state - Rows held and the bound that produced them.
 * @returns Every raw row the account yielded, plus the exhaustion fact.
 */
async function walk<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, state: IWalkState): WalkOutcome {
  const round = planFor(a, state);
  if (!round.plan.shouldAsk) {
    const collected = stopAt(state, round.coverage);
    return succeed(collected);
  }
  const next = await extend(a, { ...state, end: round.plan.nextEnd });
  return isOk(next) ? walk(a, next.value) : next;
}

/**
 * Collect every raw transaction row for one account.
 *
 * @param a - Per-account context.
 * @returns Raw rows from the first request and any backfill it earned,
 *          plus whether that backfill fell short of the requested window.
 */
export async function collectAccountRows<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<ICollectedRows>> {
  const first = await fetchOnce(a);
  if (!isOk(first)) return first;
  const seed: IWalkState = { rows: first.value, end: a.ctx.windowEnd, attempt: 0 };
  return walk(a, seed);
}

export default collectAccountRows;
