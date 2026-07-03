/**
 * Max scrape shape — response row filtering. getTransactionsAndGraphs returns
 * ALL cards merged in `result.transactions[]` (firstCallCardIndex=-1); the
 * driver fetches per-account, so each account's page filters the merged rows
 * to its own card by `shortCardNumber === last4`. Rows are passed through
 * untouched; the downstream Data Mapper normalises fields (purchaseDate,
 * paymentSum…). Split from MaxShapeTxns.ts for the 150-LOC cap.
 */

type MaxTxn = Record<string, unknown>;

interface ITxnsResult {
  readonly transactions?: readonly MaxTxn[];
}
interface ITxnsResp {
  readonly result?: ITxnsResult | null;
}

/**
 * All merged transaction rows for the month (result.transactions[]);
 * tolerates a null result by yielding no rows.
 * @param resp - Unwrapped transactions response.
 * @returns All rows across every card.
 */
function allRows(resp: ITxnsResp): readonly MaxTxn[] {
  return resp.result?.transactions ?? [];
}

/**
 * True when a row belongs to the given card (shortCardNumber === last4).
 * @param row - Raw transaction row.
 * @param last4 - Account card last-4.
 * @returns Whether the row is this card's.
 */
function matchesCard(row: MaxTxn, last4: string): boolean {
  const rowCard = typeof row.shortCardNumber === 'string' ? row.shortCardNumber : '';
  return rowCard === last4;
}

/**
 * Filter one month's merged rows to a single card (by last-4).
 * @param body - Raw getTransactionsAndGraphs response body.
 * @param last4 - Account card last-4.
 * @returns Rows belonging to the card.
 */
export function filterMaxRows(body: object, last4: string): readonly object[] {
  const resp = body as ITxnsResp;
  const rows = allRows(resp);
  return rows.filter((r): boolean => matchesCard(r, last4));
}

export default filterMaxRows;
