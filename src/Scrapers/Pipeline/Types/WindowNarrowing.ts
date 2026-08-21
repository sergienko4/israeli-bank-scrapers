/**
 * What a narrower scrape window would change for one bank's transactions
 * request — the declaration the backfill loop dispatches on.
 *
 * Lives in `Types/` rather than beside the shape interface because both sides
 * of the question need it: the shape *declares* a stance, and the Mediator
 * *acts* on one. Anchoring it in the shared layer keeps the Mediator from
 * reaching upward into a phase for a type.
 */

/**
 * How a bank's transactions request expresses the window's upper bound —
 * declared per the hard-model rule, never inferred.
 *
 * Probed across all 16 shapes (see `docs/phases/api-direct-scrape.md`): the
 * encodings share nothing — `YYYYMMDD` in a query param, `YYYY-MM-DD` in a
 * body, RFC-1123 inside a JSON string, a structured `{Day,Month,Year}` filter,
 * a billing month — so the stance cannot be read off the wire.
 */
export type WindowNarrowing =
  /** Honours a narrowed `ctx.windowEnd`; a coverage gap can be backfilled. */
  | 'windowEnd'
  /**
   * Request names a fixed provider period (a billing month) rather than a
   * range. Every period covering the window is already requested and none can
   * be sub-divided, so a gap *inside* one period has no narrower re-ask.
   */
  | 'periodEnumeration'
  /** Request carries no upper bound to move; a gap can only be reported. */
  | 'lowerBoundOnly'
  /** Provider supplies the next-page token and owns completeness. */
  | 'providerCursor';

/** Every stance that cannot close a gap by asking again. */
export type UnbackfillableStance = Exclude<WindowNarrowing, 'windowEnd'>;

/**
 * Why each excluded stance cannot close a coverage gap by re-asking.
 *
 * A map rather than a branch, so adding a stance is a compile error here
 * instead of a bank that silently drops out of the backfill. The text is
 * logged verbatim: an operator reading "gap, no backfill" deserves the reason
 * in the same line, not a source dive.
 */
export const BACKFILL_EXCLUSION: Readonly<Record<UnbackfillableStance, string>> = Object.freeze({
  periodEnumeration:
    'provider period is indivisible — a gap inside one billing period has no narrower request',
  lowerBoundOnly: 'provider accepts no upper bound to move',
  providerCursor: 'walk is driven by a provider cursor, not by dates',
});
