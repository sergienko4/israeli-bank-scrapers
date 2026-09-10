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

import { isLossyTermination } from '../../Mediator/Scrape/CoverageAudit/TerminationEvidence.js';
import type { IWindowResult } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { assessWindowCoverage } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import type { WindowStop } from '../../Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
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
  /**
   * How pagination ended, worst round wins.
   *
   * <p>Monotonic on purpose. Each backfill round runs its own paginated walk,
   * so keeping only the newest answer would let a clean final round erase an
   * earlier halt — the walk would look exhausted when an earlier round had
   * already proved it was not.
   */
  readonly termination: PaginationTermination;
}

/**
 * Fold one round's termination into the walk's, worst case winning.
 *
 * `exhausted` is the only clean answer, so anything else sticks: once a round
 * has stopped short, no later round can un-prove it.
 *
 * @param held - Termination the walk already carries.
 * @param incoming - Termination the newest round produced.
 * @returns Whichever of the two represents less certainty.
 */
function keepWorst(
  held: PaginationTermination,
  incoming: PaginationTermination,
): PaginationTermination {
  return held === 'exhausted' ? incoming : held;
}

/** What a stopped walk settled on about the window it was asked for. */
export interface IWalkEnd {
  /** The start the caller asked for, as rendered for the audit. */
  readonly requestedStart: string;
  /** What the window audit made of the rows held. */
  readonly coverage: IWindowResult;
  /** Why the backfill loop stopped asking for more. */
  readonly stop: WindowStop;
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
  /**
   * How the account's pagination ended, worst round winning.
   *
   * <p>Only `exhausted` means the provider said it was finished. The other
   * three mean the walk stopped on its own terms and rows it never saw may
   * exist — a fact the date-based window verdict cannot detect on its own.
   */
  readonly termination: PaginationTermination;
  /**
   * What the walk settled on about the window, as the classifier needs it.
   *
   * <p>Carried raw rather than already classified because the verdict cannot
   * be reached here: the mapper runs after this walk and can still reject
   * rows, so a `covered` decided at this point could be contradicted a moment
   * later. Classification happens once, above the mapper.
   */
  readonly window: IWalkEnd;
}

/** One round of the walk: what the rows prove, and what to do next. */
interface IRound {
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
async function fetchOnce<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IPaginatedWalk<object>>> {
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
  const incoming = more.value.items;
  const fresh = dropOverlap({ collected: state.rows, incoming, label: labelOf(a) });
  const rows = [...state.rows, ...fresh.kept];
  const termination = keepWorst(state.termination, more.value.termination);
  return succeed({ rows, end: state.end, attempt: state.attempt + 1, termination });
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
  const time = start.getTime();
  return Number.isNaN(time) ? 'invalid-date' : start.toISOString();
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
  const requestedStart = renderStart(a.ctx.options.startDate);
  const coverage = assessWindowCoverage({ requestedStart, rows: state.rows, label });
  const spent = { attempt: state.attempt, previousEnd: state.end };
  const stance = a.shape.transactions.windowNarrowing;
  const plan = planBackfill({ stance, coverage, label, ...spent });
  return { requestedStart, coverage, plan };
}

/**
 * Close the walk, recording whether backfill was spent without covering.
 *
 * Both conditions are required. A short window that was never asked about is
 * not exhaustion, and a covered window is not short however many asks it took.
 *
 * @param a - Per-account context, holding the evidence ledger.
 * @param state - Rows held and the asks spent reaching them.
 * @param window - What the walk settled on about the requested window.
 * @returns The account's rows plus the exhaustion fact.
 */
function stopAt<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
  window: IWalkEnd,
): ICollectedRows {
  const didAsk = state.attempt > 0;
  const isShort = window.stop !== 'covered';
  const isLossy = isLossyTermination(state.termination);
  a.ledger.noteWhen('paginationStoppedEarly', isLossy);
  const isBackfillExhausted = didAsk && isShort;
  const termination = state.termination;
  return { rows: state.rows, isBackfillExhausted, termination, window };
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
  const plan = round.plan;
  if (plan.shouldAsk) {
    const next = await extend(a, { ...state, end: plan.nextEnd });
    return isOk(next) ? walk(a, next.value) : next;
  }
  const { requestedStart, coverage } = round;
  const collected = stopAt(a, state, { requestedStart, coverage, stop: plan.stop });
  return succeed(collected);
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
  const rows = first.value.items;
  const termination = first.value.termination;
  const seed: IWalkState = { rows, end: a.ctx.windowEnd, attempt: 0, termination };
  return walk(a, seed);
}

export default collectAccountRows;
