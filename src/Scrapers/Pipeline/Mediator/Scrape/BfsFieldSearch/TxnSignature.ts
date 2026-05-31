/**
 * Transaction-signature scoring — classifies candidate JSON
 * objects as "looks like a transaction" by counting well-known
 * field overlaps.
 *
 * Sub-split out of BfsFieldSearch.ts during Phase 5 to keep both
 * files under the per-cluster max-lines:150 eff cap (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import type { ApiRecord, UntypedValue } from '../AutoMapperFacade/AutoMapperTypes.js';
import { isSearchableObject } from './BfsFieldSearch.js';

/** Minimum WK field matches for a txn array. */
const MIN_TXN_SCORE = 2;

/** WK field names indicating a transaction record. */
const TXN_SIGNATURE_FIELDS = new Set(
  [
    ...WK.date,
    ...WK.amount,
    ...WK.debitAmount,
    ...WK.creditAmount,
    ...WK.description,
    ...WK.identifier,
  ].map((f): string => f.toLowerCase()),
);

/**
 * Score how many WK txn fields an object has.
 * @param item - Object to score.
 * @returns Number of matching WK transaction fields.
 */
function scoreTxnSignature(item: UntypedValue): number {
  if (!isSearchableObject(item)) return 0;
  const keys = Object.keys(item as object).map((k): string => k.toLowerCase());
  return keys.filter((k): boolean => TXN_SIGNATURE_FIELDS.has(k)).length;
}

/**
 * Cast searchable items to typed records.
 * @param items - Raw items to filter and cast.
 * @returns Typed record array.
 */
function castSearchable(items: readonly UntypedValue[]): readonly ApiRecord[] {
  return items.filter((i): boolean => isSearchableObject(i)).map((i): ApiRecord => i as ApiRecord);
}

export { castSearchable, MIN_TXN_SCORE, scoreTxnSignature, TXN_SIGNATURE_FIELDS };
