/**
 * Phase G detector — picks the per-card dedup-key field tuple from a
 * harvest sample by shape inspection.
 *
 * <p>Banks whose API exposes a per-txn unique identifier resolve the
 * minimal tuple `['identifier']`. Banks whose identifier field is a
 * transaction-TYPE code (shared across recurring monthly txns —
 * Beinleumi's `reference` is the canonical case) resolve the
 * composite tuple `['date', 'identifier', 'originalAmount']`.
 *
 * <p>Pure synchronous function: no I/O, no global state, deterministic.
 * Mirrors the SHAPE-driven pattern of `BillingCycleCatalogDetector`.
 * Empty input is unreachable in production (the caller in TxnParser
 * skips the detector when `records.length === 0`) — defensive
 * fallback to `['identifier']` keeps the contract total.
 */

import type { ITransaction } from '../../../../Transactions.js';

/** Tuple emitted when every row has a distinct identifier. */
const ID_ONLY: readonly string[] = ['identifier'];

/** Tuple emitted when identifier collides across rows in the sample. */
const COMPOSITE: readonly string[] = ['date', 'identifier', 'originalAmount'];

/**
 * Reports whether one row would collide under the ID-only tuple.
 * Pure check — caller maintains the running set of seen ids.
 * @param row - Single transaction.
 * @param seen - Set of identifiers seen so far in the sample.
 * @returns True when the row safely fits ID-only; false when it
 *   either has no identifier or its identifier collides.
 */
function rowFitsIdOnly(row: ITransaction, seen: Set<string>): boolean {
  if (row.identifier === undefined) return false;
  const key = String(row.identifier);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * Reports whether every row has a present identifier AND every value
 * is distinct (the precondition for the minimal `['identifier']`
 * tuple). Banks where any row's identifier is absent or any value
 * collides across rows must use the composite tuple.
 *
 * @param rows - Harvest sample.
 * @returns True when ID-only is safe; false otherwise.
 */
function everyRowHasDistinctIdentifier(rows: readonly ITransaction[]): boolean {
  const seen = new Set<string>();
  return rows.every((row): boolean => rowFitsIdOnly(row, seen));
}

/**
 * Resolves the dedup-key field tuple for a per-card harvest sample.
 *
 * <p>The composite tuple `['date','identifier','originalAmount']`
 * handles BOTH within-capture identifier collisions (Beinleumi recurring
 * salary transfers under the same `reference` code) AND identifier-absent
 * rows (Beinleumi placeholder `reference: 0` coerced to undefined) — the
 * key composer joins values via `String(...)` so an absent identifier
 * still produces a distinct composed key when paired with its row's
 * date + amount.
 *
 * @param rows - Harvest sample (one card's `ITransaction[]`).
 * @returns Non-empty array of `ITransaction` field names SCRAPE must
 *   use to compose the dedup key. Defaults to `['identifier']` for
 *   empty input (defensive — production callers skip the detector
 *   on empty harvests).
 */
export default function detectDedupKeyFields(rows: readonly ITransaction[]): readonly string[] {
  if (rows.length === 0) return ID_ONLY;
  if (everyRowHasDistinctIdentifier(rows)) return ID_ONLY;
  return COMPOSITE;
}
