/**
 * Max per-card cycle balance — reads the ILS row of one card's `CycleSummary`.
 *
 * `getHomePageData` — already fetched by the customer step for the card list —
 * returns `Result.UserCards.Cards[]`, and every card carries both its own
 * `CycleSummary[]` (one row per currency) and the `Last4Digits` that IS Max's
 * account number. The sibling `Result.UserCards.Summary[]` is the all-cards
 * aggregate; the per-card rows are the breakdown behind it.
 *
 * That co-location is what makes the figure usable: it sits on the same object
 * as the identifier defining the account, so it attributes to exactly one
 * account. The other card issuers publish only a household total on a
 * different dimension (a billing month, or a bank account with no card
 * mapping), which is why they keep the 0 sentinel — see the balance notes in
 * their shapes.
 */

import { ILS_CURRENCY_CODE } from '../../../Registry/WK/BalanceResolveWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Outstanding ILS cycle debit of one card — branded for Rule #15. */
export type MaxCardCycleBalance = Brand<number, 'MaxCardCycleBalance'>;

/** The 0 a card-cycle bank reports when no usable figure is on the wire. */
const NO_CYCLE_DEBIT = 0 as MaxCardCycleBalance;

/** One per-currency row of a Max card's billing-cycle summary. */
export interface IMaxCycleRow {
  readonly Currency?: number;
  readonly TotalDebitSum?: number;
}

/** The subset of a raw Max card that the cycle reader consumes. */
export interface IMaxRawCycle {
  readonly CycleSummary?: readonly IMaxCycleRow[] | null;
}

/**
 * Read a card's cycle rows without trusting their element type.
 *
 * The declared element type describes what the bank documents, not what the
 * wire can carry: `Array.isArray` proves only the container, and a JSON null
 * or a primitive sitting in one slot would still satisfy it. Elements stay
 * `unknown` so every field read goes through {@link isIlsRow} first.
 * @param card - Raw card entry.
 * @returns Cycle rows as unvalidated elements, or an empty list.
 */
function cycleRows(card: IMaxRawCycle): readonly unknown[] {
  const rows: unknown = card.CycleSummary;
  return Array.isArray(rows) ? (rows as readonly unknown[]) : [];
}

/**
 * Whether one element is the ILS row.
 *
 * Rejects null and primitives before reading a field, so a malformed slot
 * costs the row rather than the scrape.
 * @param row - One unvalidated element of the cycle summary.
 * @returns True when the element is a record whose currency is ILS.
 */
function isIlsRow(row: unknown): row is IMaxCycleRow {
  if (typeof row !== 'object' || row === null) return false;
  const record = row as IMaxCycleRow;
  return record.Currency === ILS_CURRENCY_CODE;
}

/**
 * Read one card's outstanding ILS cycle debit.
 *
 * Returns 0 — the sentinel a card-cycle bank has always reported — whenever
 * the summary is missing, is not the array the contract promises, carries a
 * malformed row in place of the ILS one, carries no ILS row at all, or holds
 * a non-finite figure. Degrading to the historical value rather than throwing
 * or surfacing NaN keeps a wire-shape change from failing a scrape that has
 * otherwise succeeded.
 * @param card - Raw card entry (reads `CycleSummary` only).
 * @returns Outstanding ILS cycle debit, or 0 when unavailable.
 */
export function ilsCycleDebit(card: IMaxRawCycle): MaxCardCycleBalance {
  const rows = cycleRows(card);
  const ils = rows.find(isIlsRow);
  const total = ils?.TotalDebitSum;
  if (typeof total !== 'number' || !Number.isFinite(total)) return NO_CYCLE_DEBIT;
  return total as MaxCardCycleBalance;
}
