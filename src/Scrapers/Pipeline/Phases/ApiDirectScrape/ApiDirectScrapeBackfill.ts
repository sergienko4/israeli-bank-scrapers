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

/**
 * Per-account row collection — the first request plus any backfill it earns.
 *
 * The window-coverage audit can say "the rows do not reach back to the start",
 * and for eight of the sixteen banks that shortfall is answerable: narrow the
 * upper bound to just before the oldest row held and ask again. This file owns
 * that loop. One round — the request itself plus the assessment of what the
 * rows prove — lives in ApiDirectScrapeWalkRounds.ts; the loop here decides
 * whether to ask again. It holds no bank knowledge — the stance comes from the
 * shape's declaration and every decision comes from {@link planBackfill}.
 */

import { isLossyTermination } from '../../Mediator/Scrape/CoverageAudit/TerminationEvidence.js';
import type { IWindowResult } from '../../Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import type { WindowStop } from '../../Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
import type { IPaginatedWalk, PaginationTermination } from '../../Strategy/Fetch/Pagination.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IAcctCtx } from './ApiDirectScrapeTypes.js';
import {
  extend,
  fetchInitial,
  type IWalkState,
  planFor,
  validateRequestPlan,
} from './ApiDirectScrapeWalkRounds.js';

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
   * <p>`exhausted` means the planned cursor walk completed without a detected
   * halt; it does not prove provider retention. `cursorRepeat` and
   * `pageCeiling` may leave rows unseen. `predicateStop` is caller-controlled,
   * so the independent date audit decides whether it stopped late enough.
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
  const isBackfillExhausted = noteWalkEnd(a, state, window.stop);
  const termination = state.termination;
  return { rows: state.rows, isBackfillExhausted, termination, window };
}

/**
 * Record the walk's termination evidence and report whether backfill fell short.
 *
 * Both conditions are required: a window that was never re-asked is not
 * exhaustion, and a covered window is not short however many asks it took.
 * @param a - Per-account context, holding the evidence ledger.
 * @param state - Rows held and the asks spent reaching them.
 * @param stop - How the walk ended.
 * @returns True when backfill was spent without covering the window.
 */
function noteWalkEnd<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
  stop: IWalkEnd['stop'],
): boolean {
  const isLossy = isLossyTermination(state.termination);
  a.ledger.noteWhen('paginationStoppedEarly', isLossy);
  return state.attempt > 0 && stop !== 'covered';
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
  if (plan.shouldAsk) return askAgain(a, state, plan.nextEnd);
  const { requestedStart, coverage } = round;
  const collected = stopAt(a, state, { requestedStart, coverage, stop: plan.stop });
  return succeed(collected);
}

/**
 * Re-ask under the narrowed bound, then continue the walk on its result.
 * @param a - Per-account context.
 * @param state - Rows held and the bound that produced them.
 * @param end - The narrowed upper bound.
 * @returns The continued walk, or the failed request.
 */
async function askAgain<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  state: IWalkState,
  end: IWalkState['end'],
): WalkOutcome {
  const next = await extend(a, { ...state, end });
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
  const validation = validateRequestPlan(a);
  if (!isOk(validation)) return validation;
  const first = await fetchInitial(a);
  if (!isOk(first)) return first;
  const state = seedWalk(a, first.value);
  return walk(a, state);
}

/**
 * Seed the walk state from the initial page and the caller's window end.
 * @param a - Per-account context.
 * @param first - The initial page.
 * @returns State for the first backfill round.
 */
function seedWalk<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  first: IPaginatedWalk<object>,
): IWalkState {
  const end = a.ctx.windowEnd;
  return { rows: first.items, end, attempt: 0, termination: first.termination };
}

export default collectAccountRows;
