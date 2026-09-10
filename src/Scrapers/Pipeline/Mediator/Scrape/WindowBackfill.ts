/**
 * Backfill planning — deciding whether an uncovered window can be closed by
 * asking the provider again for an older slice.
 *
 * The window-coverage audit answers "do the rows reach back to `startDate`?"
 * but deliberately calls a shortfall `unproven` rather than `truncated`: a
 * quiet account and a capped one look identical from one response. Only
 * re-requesting the uncovered slice separates them. This module decides
 * whether that second request is possible and what bound it should carry; the
 * phase owns the loop that issues it.
 *
 * Every decision is logged, in both directions. A bank that cannot backfill is
 * never silently skipped — "we asked and could not get more" and "we never
 * asked" are different facts and an operator must be able to tell them apart.
 */

import { getDebug } from '../../Logging/Debug.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import { BANK_DAY_FORMAT, bankDayOfInstant, parseInBankZone } from './BankCalendar.js';
import type { BackfillStop, IBackfillBlock, IBackfillPlanArgs } from './WindowBackfillBlocks.js';
import { blockOf, BOUND_DID_NOT_MOVE } from './WindowBackfillBlocks.js';

const LOG = getDebug(import.meta.url);

/** Issue another request under a narrowed bound. */
export interface IBackfillAsk {
  readonly shouldAsk: true;
  /** Upper bound for that request. */
  readonly nextEnd: Option<Date>;
  /** Why — logged verbatim. */
  readonly reason: string;
}

/** Stop asking, and say what ended it. */
export interface IBackfillRefusal {
  readonly shouldAsk: false;
  /** Always absent: there is no next request to bound. */
  readonly nextEnd: Option<Date>;
  /** Why — logged verbatim. */
  readonly reason: string;
  /**
   * The same answer as a code, for callers that must act on it.
   *
   * The prose above is written for an operator and is pinned byte-for-byte by
   * tests; this is what the coverage classifier reads, so no caller ever has
   * to parse a log line. Present only on this branch, so a caller that has not
   * established the loop actually stopped cannot reach for it.
   */
  readonly stop: BackfillStop;
}

/** What the loop should do next. Never carries row content. */
export type IBackfillPlan = IBackfillAsk | IBackfillRefusal;

/**
 * The end of the oldest day we hold, as the next request's bound.
 *
 * <p>Inclusive of that day, not the day before it. Provider truncation is not
 * always date-aligned: Hapoalim caps a page by **row count**, so a cut lands
 * mid-day whenever the boundary day holds more rows than the page budget left.
 * Resuming at `oldest - 1` would step straight over the rows the cap withheld
 * and lose them permanently — the exact silent loss this module exists to
 * close. Re-asking the boundary day instead re-serves rows we already hold, and
 * {@link dropOverlap} — a multiset difference on raw row identity — spends one
 * held copy per re-served row, so only the withheld ones survive.
 *
 * <p>End of day, not start of day, because not every consumer of this bound is
 * day-granular. Most backfillable banks render it back to a day label —
 * `YYYYMMDD` for Hapoalim, `YYYY-MM-DD` for the FIBI group and Pepper, month
 * components for Yahav — to which the time of day is invisible; Leumi puts it
 * on the wire as an RFC-1123 *instant* (`toUTCString()`). A start-of-day
 * instant would exclude everything that day after midnight.
 *
 * <p><b>Bank-anchored, like every other calendar decision in this cluster.</b>
 * The day label means a day in the bank's zone, so the instant it opens onto
 * must be that day's end there. Reading it ambiently made the bound mean a
 * different real moment per host: Leumi sends it absolutely, so from a
 * west-of-Israel host the re-ask landed *after* the rows already held, the
 * provider re-served the same set, `oldest` never moved and the next round
 * refused with `boundDidNotMove` — backfill dead on the first retry.
 *
 * <p>Every consumer that turns this instant back into a day label must read it
 * in the bank's zone too, or an east-of-Israel host re-asks for `oldest + 1`.
 * The pair moves together; `BankCalendar.test.ts` pins both halves.
 *
 * <p>Termination is unaffected. A request that returns nothing new leaves
 * `oldest` where it was, which derives this same bound again, and
 * {@link isEarlier} refuses a non-strict step.
 *
 * @param oldest - Calendar day of the oldest row collected.
 * @returns Last instant of that calendar day in the bank's zone.
 */
function endOfOldest(oldest: string): Date {
  return parseInBankZone(oldest, BANK_DAY_FORMAT).endOf('day').toDate();
}

/**
 * Whether the next bound actually moves the window backwards.
 *
 * This is the loop's termination guarantee. A request that returns nothing new
 * leaves `oldest` where it was, which derives the same bound again — so a
 * non-strict step is exactly the "made no progress" case, and refusing it
 * stops the loop without a separate counter.
 *
 * @param next - Bound the loop would use.
 * @param previous - Bound the assessed request carried.
 * @returns True when `next` is strictly earlier.
 */
function isEarlier(next: Date, previous: Option<Date>): boolean {
  if (!isSome(previous)) return true;
  return next.getTime() < previous.value.getTime();
}

/**
 * Emit the decision and return it, so callers decide and report in one step.
 *
 * A gap that will not be re-asked warns: it is the case an operator must see.
 *
 * @param args - The decision inputs.
 * @param plan - The decision reached.
 * @returns The same plan.
 */
function report(args: IBackfillPlanArgs, plan: IBackfillPlan): IBackfillPlan {
  const message = `backfill ${args.label}: ${plan.reason}`;
  const isRoutine = plan.shouldAsk || args.coverage.verdict === 'covered';
  if (isRoutine) LOG.debug({ message });
  else LOG.warn({ message });
  return plan;
}

/**
 * Refuse another request, reporting the gap and the reason together.
 * @param args - The decision inputs.
 * @param block - The code and prose for why no further request will be made.
 * @returns The refusal.
 */
function refuse(args: IBackfillPlanArgs, block: IBackfillBlock): IBackfillPlan {
  const gap = `gapDays=${String(args.coverage.gapDays)}`;
  const reason = `${gap} — ${block.reason}`;
  const plan: IBackfillPlan = { shouldAsk: false, nextEnd: none(), reason, stop: block.stop };
  return report(args, plan);
}

/**
 * Authorise another request under a narrowed bound.
 * @param args - The decision inputs.
 * @param next - Upper bound for the next request.
 * @param gap - Rendered gap size, for the log line.
 * @returns The authorisation.
 */
function accept(args: IBackfillPlanArgs, next: Date, gap: string): IBackfillPlan {
  // Read in the bank's zone, like the shapes that put it on the wire. Reading
  // it ambiently would log a different day than was actually sent.
  const day = bankDayOfInstant(next);
  const when = day === false ? 'unreadable' : day;
  const reason = `${gap} — re-asking with end=${when}`;
  const plan: IBackfillPlan = { shouldAsk: true, nextEnd: some(next), reason };
  return report(args, plan);
}

/**
 * Decide whether to re-ask the provider for the slice still unaccounted for.
 *
 * @param args - Stance, coverage so far, attempts spent, and the last bound.
 * @returns The decision, already reported.
 */
export function planBackfill(args: IBackfillPlanArgs): IBackfillPlan {
  const blocked = blockOf(args);
  if (blocked !== false) return refuse(args, blocked);
  const next = endOfOldest(args.coverage.oldest);
  const didMove = isEarlier(next, args.previousEnd);
  if (!didMove) return refuse(args, BOUND_DID_NOT_MOVE);
  const gap = `gapDays=${String(args.coverage.gapDays)}`;
  return accept(args, next, gap);
}

export type { BackfillStop, IBackfillPlanArgs } from './WindowBackfillBlocks.js';
export { MAX_BACKFILL_ASKS } from './WindowBackfillBlocks.js';
export default planBackfill;
