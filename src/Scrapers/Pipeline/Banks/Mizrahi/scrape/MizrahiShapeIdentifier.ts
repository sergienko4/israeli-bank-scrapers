/**
 * Mizrahi scrape shape — the transaction identifier.
 *
 * <p>The legacy scraper published `<reference>-<TransactionNumber>` when one
 * reference (`MC02AsmahtaMekoritEZ`) holds several movements, else the
 * reference as a number. The shape attaches that id to each row as
 * `mizrahiIdentifier`, first in the WK identifier aliases, so consumers'
 * stored identifiers survive the move and two movements that share a
 * reference stay apart.
 */

import type { JsonUnknownRecord } from '../../../Types/JsonValue.js';

/** Synthesized identifier key — first in the WK identifier aliases. */
const IDENTIFIER_KEY = 'mizrahiIdentifier';
/** `TransactionNumber` of a reference's only movement. */
const SOLE_TXN_NUMBER = '1';

/** The row fields the identifier derives from. */
interface IIdentifierFields {
  readonly MC02AsmahtaMekoritEZ?: string | null;
  readonly TransactionNumber?: string | number | null;
}

/**
 * The legacy identifier of one row. A reference that is not numeric is kept
 * as the string, where the legacy scraper would have published NaN.
 * @param row - Raw `body.table.rows[]` entry.
 * @returns The identifier, or false when the row has no reference.
 */
function legacyIdentifierOf(row: Readonly<JsonUnknownRecord>): string | number | false {
  const { MC02AsmahtaMekoritEZ: ref, TransactionNumber: txnNo } = row as IIdentifierFields;
  if (typeof ref !== 'string' || ref === '') return false;
  const isSplit = Boolean(txnNo) && String(txnNo) !== SOLE_TXN_NUMBER;
  if (isSplit) return `${ref}-${String(txnNo)}`;
  const numeric = Number.parseInt(ref, 10);
  return Number.isNaN(numeric) ? ref : numeric;
}

/**
 * The row with its legacy identifier attached under `mizrahiIdentifier`.
 * @param row - Raw transaction row.
 * @returns A copy carrying the identifier, or the row when it has none.
 */
export default function withIdentifier(
  row: Readonly<JsonUnknownRecord>,
): Readonly<JsonUnknownRecord> {
  const identifier = legacyIdentifierOf(row);
  if (identifier === false) return row;
  return { ...row, [IDENTIFIER_KEY]: identifier };
}
