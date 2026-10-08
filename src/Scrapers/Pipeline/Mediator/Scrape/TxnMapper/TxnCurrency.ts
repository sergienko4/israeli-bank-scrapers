/**
 * Txn currency resolution — picks a record's original currency from the
 * WK `currency` alias list and normalises shekel aliases to `ILS`.
 *
 * <p>The alias list is first-match-wins, and its order decides what
 * `ITransaction.originalCurrency` reports (issue #614: DigitalV3 rows
 * carry a numeric enum beside the ISO code). A blank or whitespace-only
 * value is treated as absent so it cannot win the match and mask the
 * next usable alias: the shared scalar matcher accepts `''`, which the
 * string coercion then turns into the `ILS` default, silently
 * mislabelling a foreign-currency transaction.
 *
 * <p>Search order matches `findFieldValue`: the root record first, then
 * nested non-array object records breadth-first, down to
 * `MAX_SEARCH_DEPTH` levels. A usable root currency takes precedence;
 * nested records are consulted only after a root miss.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import type { ApiRecord, ScalarFieldHit } from '../AutoMapperFacade/AutoMapperTypes.js';
import { flattenObjectTree, matchFieldInRecord } from '../BfsFieldSearch/BfsFieldSearch.js';

/** Shekel currency aliases from WK. */
const SHEKEL_ALIASES = new Set(WK.shekelAliases);

/** One `[key, value]` pair of a raw record. */
type RecordEntry = readonly [string, unknown];

/**
 * Whether a record entry carries a usable value for currency matching.
 * @param entry - Record key/value pair.
 * @returns False only for blank or whitespace-only strings.
 */
function hasUsableValue(entry: RecordEntry): boolean {
  const value = entry[1];
  return typeof value !== 'string' || value.trim() !== '';
}

/**
 * Match the WK currency aliases against one record, ignoring blank values.
 * @param record - One record of the flattened tree.
 * @returns First non-blank currency hit in alias order, or false.
 */
function matchUsableCurrency(record: ApiRecord): ScalarFieldHit {
  const entries = Object.entries(record);
  const usable = entries.filter(hasUsableValue);
  const cleaned = Object.fromEntries(usable);
  return matchFieldInRecord(cleaned, WK.currency);
}

/**
 * Find a usable currency in the nested records once the root has none.
 *
 * <p>Index 0 of the flattened tree is the root, which the caller has
 * already matched, so it is skipped; the search stops at the first
 * record that yields a usable hit.
 * @param raw - Raw API record.
 * @returns First non-blank currency hit, or false when none exists.
 */
function findInNestedRecords(raw: ApiRecord): ScalarFieldHit {
  const nested = flattenObjectTree(raw).slice(1);
  const record = nested.find((r): boolean => matchUsableCurrency(r) !== false);
  if (record === undefined) return false;
  return matchUsableCurrency(record);
}

/**
 * Find a record's raw currency value, root record first.
 * @param raw - Raw API record.
 * @returns First non-blank currency hit, or false when none exists.
 */
function findCurrencyHit(raw: ApiRecord): ScalarFieldHit {
  const rootHit = matchUsableCurrency(raw);
  if (rootHit !== false) return rootHit;
  return findInNestedRecords(raw);
}

/**
 * Normalize currency — convert shekel aliases to standard ILS.
 * @param raw - Raw currency string.
 * @returns Normalized currency code.
 */
function normalizeCurrency(raw: string): string {
  if (SHEKEL_ALIASES.has(raw)) return 'ILS';
  return raw;
}

export { findCurrencyHit, normalizeCurrency };
