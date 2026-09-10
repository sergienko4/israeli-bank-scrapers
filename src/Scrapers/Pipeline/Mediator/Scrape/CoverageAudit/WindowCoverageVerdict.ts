/**
 * Turn the walk's observations into the one verdict a caller may act on.
 *
 * Everything this module needs has already been measured: the window audit
 * said whether the oldest row reached the requested start, the backfill loop
 * said why it stopped asking, and the evidence ledger holds every guardrail
 * that reported loss along the way. Nothing here re-derives any of that. Its
 * only job is to refuse to claim more than those three sources support.
 *
 * <p><b>Why `covered` needs both halves.</b> Reaching the start date proves the
 * far edge of the window was served. It proves nothing about what happened in
 * between — a page the shape failed to read, a row the mapper refused, a
 * paginator that stopped on a repeated cursor all leave the oldest row exactly
 * where it was. So a clean date test with a dirty ledger is
 * `lowerBoundReached`, never `covered`.
 *
 * <p><b>Why an unreadable start outranks everything.</b> Every other answer is
 * a comparison against the start the caller asked for. When that value cannot
 * be read there is nothing to compare against, and a verdict derived from it
 * would be arithmetic on a value we never understood.
 */

import type {
  IWindowCoverage,
  WindowCaveat,
  WindowUnprovenReason,
} from '../../../../../WindowCoverage.js';
import { bankDayOfInstant } from '../BankCalendar.js';
import type { IWindowResult } from './WindowCoverage.js';

/** Why the backfill loop stopped asking. `covered` is the benign member. */
export type WindowStop = 'covered' | WindowUnprovenReason;

/** Everything the verdict is derived from. Never row content. */
export interface IClassifyArgs {
  /** The start the caller asked for, as rendered for the audit. */
  readonly requestedStart: string;
  /** What the window audit made of the rows held. */
  readonly coverage: IWindowResult;
  /** Why the backfill loop stopped asking for more. */
  readonly stop: WindowStop;
  /** Every guardrail that reported loss, in the ledger's stable order. */
  readonly caveats: readonly WindowCaveat[];
}

/**
 * The gap fields, present only when the walk has a day to report.
 * @param coverage - What the window audit made of the rows held.
 * @returns The oldest day and gap, or nothing when no row carried a date.
 */
function gapFields(coverage: IWindowResult): { oldest?: string; gapDays?: number } {
  if (coverage.oldest === '') return {};
  return { oldest: coverage.oldest, gapDays: coverage.gapDays };
}

/**
 * The window was not reached — say why, and by how much when that is known.
 * @param args - Everything the verdict is derived from.
 * @param reason - What stopped the walk short.
 * @returns The unproven verdict.
 */
function unproven(args: IClassifyArgs, reason: WindowUnprovenReason): IWindowCoverage {
  const requestedStart = args.requestedStart;
  return { status: 'unproven', reason, requestedStart, ...gapFields(args.coverage) };
}

/**
 * The window was reached — say whether anything qualifies that.
 * @param args - Everything the verdict is derived from.
 * @returns `covered` when the ledger is empty, `lowerBoundReached` otherwise.
 */
function reached(args: IClassifyArgs): IWindowCoverage {
  const head = { requestedStart: args.requestedStart, oldest: args.coverage.oldest };
  if (args.caveats.length === 0) return { status: 'covered', ...head };
  return { status: 'lowerBoundReached', ...head, caveats: args.caveats };
}

/**
 * Decide what this account may honestly claim about its window.
 *
 * The stop code alone separates reached from not-reached, because the loop
 * reports `covered` exactly when the audit did — that rule leads the refusal
 * table for this reason. There is no fallback branch to get wrong.
 *
 * @param args - Audit verdict, loop stop code, and the evidence ledger.
 * @returns Exactly one of the three states.
 */
export function classifyWindowCoverage(args: IClassifyArgs): IWindowCoverage {
  const startDay = bankDayOfInstant(args.requestedStart);
  if (startDay === false) return unproven(args, 'requestedStartUnreadable');
  if (args.stop !== 'covered') return unproven(args, args.stop);
  return reached(args);
}

export default classifyWindowCoverage;
