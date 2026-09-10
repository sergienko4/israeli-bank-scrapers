/**
 * The ordered reasons a backfill ask is refused, as data rather than branches.
 *
 * Split out of `WindowBackfill.ts` so a new refusal is a table entry there and
 * a code here, with no edit to the decision function itself — and so the file
 * that owns the decision stays inside the cluster's line ceiling.
 *
 * <p>Each rule carries a **code** as well as prose. The prose is what an
 * operator reads in the log and is pinned byte-for-byte by existing tests; the
 * code is what the coverage classifier reads. Nothing parses the prose.
 */

import type { WindowUnprovenReason } from '../../../../WindowCoverage.js';
import type { Option } from '../../Types/Option.js';
import type { WindowNarrowing } from '../../Types/WindowNarrowing.js';
import { BACKFILL_EXCLUSION } from '../../Types/WindowNarrowing.js';
import type { IWindowResult } from './CoverageAudit/WindowCoverage.js';

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

/**
 * Why no further ask will be made.
 *
 * `covered` is the one benign member: the window was reached, so there is
 * nothing left to ask for. The rest are the reasons a caller may be handed a
 * short list, and each maps onto a {@link WindowUnprovenReason} of the same name.
 */
export type BackfillStop = 'covered' | WindowUnprovenReason;

/** One refusal: the code the classifier reads and the prose the operator reads. */
export interface IBackfillBlock {
  readonly stop: BackfillStop;
  readonly reason: string;
}

/** A refusal rule — when it applies, and what to say when it does. */
interface IBlockRule {
  readonly stop: BackfillStop;
  readonly blocks: (args: IBackfillPlanArgs) => boolean;
  readonly reason: (args: IBackfillPlanArgs) => string;
}

/**
 * Whether the operator switched backfill off for this run.
 * @returns True when the kill-switch is set.
 */
function isDisabled(): boolean {
  return process.env.WINDOW_BACKFILL === KILL_SWITCH;
}

/**
 * Whether the window is already reached, so there is nothing left to ask for.
 * @param args - The decision inputs.
 * @returns True when the coverage audit said covered.
 */
function isCovered(args: IBackfillPlanArgs): boolean {
  return args.coverage.verdict === 'covered';
}

/**
 * Whether the rows held offer any date to derive a narrower bound from.
 * @param args - The decision inputs.
 * @returns True when no row carried a usable date.
 */
function hasNoUsableDate(args: IBackfillPlanArgs): boolean {
  return args.coverage.oldest === '';
}

/**
 * Whether this bank's request shape can express a narrower upper bound at all.
 * @param args - The decision inputs.
 * @returns True when the stance forbids a narrowed re-ask.
 */
function cannotNarrow(args: IBackfillPlanArgs): boolean {
  return args.stance !== 'windowEnd';
}

/**
 * The bank-stance prose explaining why no narrowed re-ask is possible.
 * @param args - The decision inputs.
 * @returns The declared exclusion text for this stance.
 */
function exclusionText(args: IBackfillPlanArgs): string {
  const stance = args.stance as Exclude<WindowNarrowing, 'windowEnd'>;
  return BACKFILL_EXCLUSION[stance];
}

/**
 * Whether this account has already spent its ask ceiling.
 * @param args - The decision inputs.
 * @returns True when no ask remains.
 */
function hitCeiling(args: IBackfillPlanArgs): boolean {
  return args.attempt >= MAX_BACKFILL_ASKS;
}

/**
 * Constant prose as a reason producer, so every rule has the same shape.
 * @param text - The fixed message.
 * @returns A producer ignoring its inputs and answering that message.
 */
function fixed(text: string): (args: IBackfillPlanArgs) => string {
  return (): string => text;
}

/**
 * Refusals in decision order, most decisive first.
 *
 * <p>`covered` leads, ahead even of the operator kill-switch. The switch stops
 * further *asks*, and a window that is already covered has none left to make;
 * reporting it as switched off would tell a caller the window is in doubt when
 * the audit has just proved it is not. Below that the order is
 * cheapest-and-most-decisive: an operator override outranks a bank's stance,
 * and an undatable page offers no bound to derive.
 */
const BLOCK_RULES: readonly IBlockRule[] = Object.freeze([
  { stop: 'covered', blocks: isCovered, reason: fixed('window covered') },
  {
    stop: 'backfillDisabled',
    blocks: isDisabled,
    reason: fixed('disabled by WINDOW_BACKFILL=off'),
  },
  {
    stop: 'noRowCarriedAUsableDate',
    blocks: hasNoUsableDate,
    reason: fixed('no row carried a usable date'),
  },
  { stop: 'backfillNotSupportedForBank', blocks: cannotNarrow, reason: exclusionText },
  {
    stop: 'backfillCeilingReached',
    blocks: hitCeiling,
    reason: fixed(`reached the ${String(MAX_BACKFILL_ASKS)}-request ceiling`),
  },
]);

/** The refusal for a bound that would not move the window backwards. */
export const BOUND_DID_NOT_MOVE: IBackfillBlock = Object.freeze({
  stop: 'boundDidNotMove',
  reason: 'bound did not move',
});

/**
 * Name the first condition that forbids another request.
 * @param args - The decision inputs.
 * @returns The refusal, or false when a re-ask is allowed.
 */
export function blockOf(args: IBackfillPlanArgs): IBackfillBlock | false {
  const rule = BLOCK_RULES.find((candidate): boolean => candidate.blocks(args));
  if (rule === undefined) return false;
  return { stop: rule.stop, reason: rule.reason(args) };
}

export default blockOf;
