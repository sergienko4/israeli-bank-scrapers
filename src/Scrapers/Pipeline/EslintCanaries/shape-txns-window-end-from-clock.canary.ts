/**
 * CANARY — a transactions shape reading the clock instead of the window.
 *
 * Proves §20 (SHAPE TRANSACTIONS WINDOW-END LOCK) stays armed. The window
 * coverage backfill re-asks a bank for an older slice by handing the shape a
 * context whose `windowEnd` is narrowed; that only reaches the wire while
 * `scrapeWindowEnd(ctx)` is the single place the window's end is decided.
 * A shape that derives its bound from wall-clock time silently opts out of the
 * backfill and re-introduces the transaction loss the loop exists to close.
 *
 * Every construct below is the banned form — `verify.sh` asserts ESLint reports
 * at least one real rule ID for this file on every commit.
 */

/**
 * Banned — the bound must come from `scrapeWindowEnd(ctx)`.
 * @returns Wall-clock now, standing in for the window's end.
 */
export function endOfWindowFromClock(): Date {
  return new Date();
}

/**
 * Banned — same defect expressed through moment.
 * @returns Wall-clock now as an epoch milliseconds value.
 */
export function endOfWindowFromMoment(): number {
  return moment().valueOf();
}

/**
 * Banned — same defect expressed through the static clock reader.
 * @returns Wall-clock now as an epoch milliseconds value.
 */
export function endOfWindowFromDateNow(): number {
  return Date.now();
}

/**
 * Local stand-in so the canary parses without pulling the real dependency.
 * @returns A moment-like object exposing only what this fixture needs.
 */
declare function moment(): { valueOf: () => number };
