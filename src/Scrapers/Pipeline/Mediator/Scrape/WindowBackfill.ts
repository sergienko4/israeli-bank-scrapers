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

import moment from 'moment';

import { getDebug } from '../../Logging/Debug.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { WindowNarrowing } from '../../Types/WindowNarrowing.js';
import { BACKFILL_EXCLUSION } from '../../Types/WindowNarrowing.js';
import type { IWindowResult } from './CoverageAudit/WindowCoverage.js';

const LOG = getDebug(import.meta.url);

/** Calendar-day form — see {@link IWindowResult.oldest}. */
const DAY = 'YYYY-MM-DD';

/**
 * Hard ceiling on extra requests per account.
 *
 * Twelve is one per month of a year-long window, which is the longest window
 * any supported provider serves. A run that has narrowed the bound twelve
 * times and still cannot reach `startDate` is not converging, and burning more
 * provider quota will not change that.
 */
export const MAX_BACKFILL_ASKS = 12;

/** Operator kill-switch: `WINDOW_BACKFILL=off` suppresses every extra ask. */
const KILL_SWITCH = 'off';

/** Inputs for one backfill decision. */
export interface IBackfillPlanArgs {
  /** The bank's declared stance — decides whether a re-ask is possible. */
  readonly stance: WindowNarrowing;
  /** Verdict for everything collected so far. */
  readonly coverage: IWindowResult;
  /** Extra requests already issued for this account. */
  readonly attempt: number;
  /** Bound the assessed request carried, so the next one must be earlier. */
  readonly previousEnd: Option<Date>;
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** What the loop should do next. Never carries row content. */
export interface IBackfillPlan {
  /** Whether to issue another request. */
  readonly shouldAsk: boolean;
  /** Upper bound for that request; absent when {@link shouldAsk} is false. */
  readonly nextEnd: Option<Date>;
  /** Why — logged verbatim, in both directions. */
  readonly reason: string;
}

/**
 * Name the first condition that forbids another request.
 *
 * Ordered cheapest-and-most-decisive first: an operator override outranks a
 * verdict, a covered window needs no reason beyond itself, and an undatable
 * page offers no bound to derive.
 *
 * @param args - The decision inputs.
 * @returns The blocking reason, or empty when a re-ask is allowed.
 */
function blockingReason(args: IBackfillPlanArgs): string {
  if (process.env.WINDOW_BACKFILL === KILL_SWITCH) return 'disabled by WINDOW_BACKFILL=off';
  if (args.coverage.verdict === 'covered') return 'window covered';
  if (args.coverage.oldest === '') return 'no row carried a usable date';
  if (args.stance !== 'windowEnd') return BACKFILL_EXCLUSION[args.stance];
  if (args.attempt >= MAX_BACKFILL_ASKS)
    return `reached the ${String(MAX_BACKFILL_ASKS)}-request ceiling`;
  return '';
}

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
 * day-granular. Seven of the eight backfillable banks render it through
 * `format('YYYYMMDD')`, to which the time of day is invisible; Leumi puts it on
 * the wire as an RFC-1123 *instant* (`toUTCString()`). A start-of-day instant
 * would exclude everything that day after midnight local.
 *
 * <p>Termination is unaffected. A request that returns nothing new leaves
 * `oldest` where it was, which derives this same bound again, and
 * {@link isEarlier} refuses a non-strict step.
 *
 * @param oldest - Calendar day of the oldest row collected.
 * @returns Last instant of that calendar day, local.
 */
function endOfOldest(oldest: string): Date {
  const shifted = moment(oldest, DAY).endOf('day');
  return shifted.toDate();
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
 * @param reason - Why no further request will be made.
 * @returns The refusal.
 */
function refuse(args: IBackfillPlanArgs, reason: string): IBackfillPlan {
  const plan: IBackfillPlan = { shouldAsk: false, nextEnd: none(), reason };
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
  const when = moment(next).format(DAY);
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
  const gap = `gapDays=${String(args.coverage.gapDays)}`;
  const blocked = blockingReason(args);
  if (blocked !== '') return refuse(args, `${gap} — ${blocked}`);
  const next = endOfOldest(args.coverage.oldest);
  const didMove = isEarlier(next, args.previousEnd);
  if (!didMove) return refuse(args, `${gap} — bound did not move`);
  return accept(args, next, gap);
}

export default planBackfill;
