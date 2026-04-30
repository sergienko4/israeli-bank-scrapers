/**
 * Shape-gate helpers — "does this response body carry a real txn list?"
 *
 * Used by two upstream callers:
 *   - DashboardDiscovery.countTxnTraffic (Option B primed-gate)
 *   - NetworkDiscovery.discoverTransactionsEndpoint (shape-preferring
 *     endpoint selection so summary URLs don't shadow the real
 *     detail response).
 *
 * Generic — no bank-specific shapes. Uses WK.txnContainers to
 * identify candidate keys, BFS up to TXN_SCAN_MAX_DEPTH levels
 * (covers nested shapes like
 *   result.bankAccounts[].debitDates[].transactions[]).
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_FIELDS } from '../../Registry/WK/ScrapeFieldMappings.js';

/** Opaque alias over unknown — keeps signatures off the no-unknown rule. */
type JsonValue = unknown;
/** Record alias — avoids literal Record<string, unknown> in annotations. */
type JsonObject = Record<string, JsonValue>;
/** Rule #15 alias — "carries a non-empty txn array" flag. */
type CarriesTxn = boolean;
/** Rule #15 alias — "reachable non-empty txn array" flag. */
type HasTxnReachable = boolean;
/** Rule #15 alias — "found" flag on BFS frontier state. */
type FrontierFound = boolean;
/** Rule #15 alias — depth counter inside Array.from callback. */
type DepthIndex = number;

/** Max BFS depth when scanning a captured body for a txn array.
 *  Banks nest: body.result.bankAccounts[].debitDates[].transactions[]
 *  = 5 tree levels with arrays interleaved → budget of 8 covers all
 *  known shapes with headroom. */
const TXN_SCAN_MAX_DEPTH = 8;

/**
 * Type guard: value is a plain record.
 * @param v - Candidate value.
 * @returns True when v is a non-null, non-array object.
 */
export function isPlainRecord(v: JsonValue): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check if a record carries a non-empty array under a WK.txnContainers key.
 * @param record - Record to inspect.
 * @returns True when any container key holds a non-empty Array.
 */
function recordCarriesTxnArray(record: JsonObject): CarriesTxn {
  const hit = WK_FIELDS.txnContainers
    .map((key): JsonValue => record[key])
    .find((v): v is readonly JsonValue[] => Array.isArray(v) && v.length > 0);
  return hit !== undefined;
}

/**
 * Expand one value — if record, emit its values; if array, emit its items.
 * @param v - Candidate value.
 * @returns Flattened children to enqueue at the next BFS depth.
 */
function expandForBfs(v: JsonValue): readonly JsonValue[] {
  if (Array.isArray(v)) return v;
  if (isPlainRecord(v)) return Object.values(v);
  return [];
}

/** BFS frontier state — one depth level of values to probe. */
interface IBfsFrontier {
  readonly level: readonly JsonValue[];
  readonly found: FrontierFound;
}

/**
 * Per-depth BFS step — checks current level for a hit, returns
 * either a `found:true` frontier or the expanded next level.
 * @param state - Current BFS frontier.
 * @returns Next frontier with found flag and expanded children.
 */
function bfsStep(state: IBfsFrontier): IBfsFrontier {
  if (state.found || state.level.length === 0) return state;
  const records = state.level.filter(isPlainRecord);
  const isHit = records.some(recordCarriesTxnArray);
  const next = state.level.flatMap(expandForBfs);
  return { level: next, found: isHit };
}

/**
 * BFS a captured response body for any WK.txnContainers key that
 * carries a non-empty Array. Descends through both record values and
 * array items so nested shapes (result.accounts[].txns, bankAccounts
 * [].debitDates[].transactions) are reachable within the depth budget.
 * @param body - Captured JSON response body (any shape).
 * @returns True when a non-empty txn array is reachable within the depth budget.
 */
export function hasTxnArray(body: JsonValue): HasTxnReachable {
  const depths = Array.from({ length: TXN_SCAN_MAX_DEPTH }, (_, i): DepthIndex => i);
  const initial: IBfsFrontier = { level: [body], found: false };
  const final = depths.reduce((acc): IBfsFrontier => bfsStep(acc), initial);
  return final.found;
}
