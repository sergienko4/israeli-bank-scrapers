/**
 * What a scrape can honestly say about the window it was asked for.
 *
 * A caller asks for transactions since a date. Today the answer is a list, and
 * a list that is short because the bank had nothing older is indistinguishable
 * from a list that is short because the walk gave up. Both arrive as `success`.
 * This module names the difference so callers can act on it.
 *
 * Three states, each provable from evidence the scrape already holds:
 *
 * - `covered` — the oldest row reaches the requested start AND every loss
 *   channel the scrape watches came back clean.
 * - `lowerBoundReached` — the oldest row reaches the requested start, but at
 *   least one channel reported loss or could not run. Rows are missing or may
 *   be, and {@link IWindowLowerBoundReached.caveats} says which channel said so.
 * - `unproven` — the requested start was never reached at all.
 *
 * There is deliberately no fourth "probably fine" state. Every state here is
 * backed by something observed; none rests on an inference about what the
 * provider meant.
 */

/**
 * Why `covered` could not be claimed even though the start date was reached.
 *
 * Each member names a channel the scrape watches for row loss. All of them are
 * measured during the walk; none is inferred afterwards.
 */
export type WindowCaveat =
  /**
   * The paginated walk gave up while the provider was still offering rows —
   * it repeated a cursor, or hit its page ceiling. A shape's own "we have
   * enough" stop does not raise this: that is sufficiency, not loss, and the
   * start-date test judges it independently.
   */
  | 'paginationStoppedEarly'
  /** The provider declared more rows in a container than were present. */
  | 'declaredRowShortfall'
  /** Rows were found in the response body that the bank shape did not return. */
  | 'extractionShortfall'
  /** The extraction audit had nothing comparable to check against. */
  | 'extractionAuditUnavailable'
  /** The mapper refused rows the shape had extracted. */
  | 'mappingRejectedRows'
  /** The provider served rows outside the order the walk assumes. */
  | 'walkOrderViolated';

/**
 * Why the requested start was never reached.
 *
 * Every member is produced by a specific stop condition in the backfill loop
 * or by the classifier itself; there is no catch-all. A member that no code
 * path can reach is a lie the type system would help tell, so none is kept
 * "just in case".
 */
export type WindowUnprovenReason =
  /** Rows arrived, but none carried a date the audit could read. */
  | 'noRowCarriedAUsableDate'
  /** The caller's own `startDate` could not be read as a date. */
  | 'requestedStartUnreadable'
  /** Backfill spent its ask ceiling without closing the gap. */
  | 'backfillCeilingReached'
  /** This bank's request shape cannot express a narrower upper bound. */
  | 'backfillNotSupportedForBank'
  /** Backfill was switched off for this run. */
  | 'backfillDisabled'
  /** A narrowed ask returned nothing older, so the walk stopped advancing. */
  | 'boundDidNotMove';

/**
 * The requested start was reached and every watched channel was clean.
 *
 * <p>This does NOT promise that no row in the middle of the window was dropped
 * without leaving a trace. Detecting that needs provider-side totals no Israeli
 * bank sends. It promises that the window's far edge was reached and that
 * nothing the scrape can observe reported loss along the way.
 */
export interface IWindowCovered {
  readonly status: 'covered';
  /** The start the caller asked for, ISO 8601. */
  readonly requestedStart: string;
  /** The oldest row's calendar day in the bank's own zone, `YYYY-MM-DD`. */
  readonly oldest: string;
}

/** The requested start was reached, but a channel reported loss or could not run. */
export interface IWindowLowerBoundReached {
  readonly status: 'lowerBoundReached';
  /** The start the caller asked for, ISO 8601. */
  readonly requestedStart: string;
  /** The oldest row's calendar day in the bank's own zone, `YYYY-MM-DD`. */
  readonly oldest: string;
  /** Every channel that blocked `covered`, in a stable order. Never empty. */
  readonly caveats: readonly WindowCaveat[];
}

/** The requested start was never reached. */
export interface IWindowUnproven {
  readonly status: 'unproven';
  /** What stopped the walk short of the requested start. */
  readonly reason: WindowUnprovenReason;
  /** The start the caller asked for, ISO 8601, or `'invalid-date'` when unreadable. */
  readonly requestedStart: string;
  /** The oldest row's calendar day, `YYYY-MM-DD` — absent when no row carried one. */
  readonly oldest?: string;
  /** Whole days between the requested start and the oldest row, when both are known. */
  readonly gapDays?: number;
}

/** One account's verdict on the window the caller asked for. */
export type IWindowCoverage = IWindowCovered | IWindowLowerBoundReached | IWindowUnproven;
