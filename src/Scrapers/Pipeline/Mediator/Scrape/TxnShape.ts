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
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../Types/Brand.js';
import type { JsonValue, MaybeJsonValue } from '../../Types/Json.js';

/** Whether a response body carries a non-empty txn array. */
type HasTxnArray = Brand<boolean, 'HasTxnArray'>;

/** Whether a URL matches a known dashboard-PREVIEW / widget pattern. */
type IsTxnWidgetUrl = Brand<boolean, 'IsTxnWidgetUrl'>;

/** Record alias — narrow JSON-typed record so type guards from JsonValue work. */
type JsonObject = Record<string, JsonValue>;

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
 * Check if a record carries a non-empty array under a WK.txnContainers
 * key (fast-path).
 * @param record - Record to inspect.
 * @returns True when any container key holds a non-empty Array.
 */
function recordCarriesTxnArray(record: JsonObject): boolean {
  const hit = WK_FIELDS.txnContainers
    .map((key): JsonValue => record[key])
    .find((v): v is readonly JsonValue[] => Array.isArray(v) && v.length > 0);
  return hit !== undefined;
}

/**
 * Phase 7f deepened gate: returns true when the record carries any
 * non-empty array whose first element exposes BOTH a date alias and
 * an amount alias from `WK_FIELDS`. Recognises bank-specific shapes
 * outside the canonical txnContainers list (e.g. Discount's
 * `CurrentAccountLastTransactions.OperationEntry[]` with
 * `OperationDate` + `OperationAmount`) without leaking bank tokens
 * into the txnContainers fast-path.
 *
 * @param record - Record to inspect.
 * @returns True when any nested array holds records exposing date AND
 *   amount aliases.
 */
function recordCarriesShapedArray(record: JsonObject): boolean {
  return Object.values(record).some((value): boolean => {
    if (!Array.isArray(value) || value.length === 0) return false;
    const first = value[0] as JsonValue;
    if (!isPlainRecord(first)) return false;
    const head = first;
    const hasDate = WK_FIELDS.date.some((key): boolean => key in head);
    const hasAmount =
      WK_FIELDS.amount.some((key): boolean => key in head) ||
      WK_FIELDS.creditAmount.some((key): boolean => key in head) ||
      WK_FIELDS.debitAmount.some((key): boolean => key in head);
    return hasDate && hasAmount;
  });
}

/**
 * Expand one value — if record, emit its values; if array, emit its items.
 * @param v - Candidate value.
 * @returns Flattened children to enqueue at the next BFS depth.
 */
function expandForBfs(v: JsonValue): readonly JsonValue[] {
  // `Array.isArray` is typed as `v is any[]` in lib.d.ts, so the narrow
  // path needs an explicit re-cast back to the value type.
  if (Array.isArray(v)) return v as readonly JsonValue[];
  if (isPlainRecord(v)) {
    const record: Record<string, JsonValue> = v;
    return Object.values(record);
  }
  return [];
}

/** BFS frontier state — one depth level of values to probe. */
interface IBfsFrontier {
  readonly level: readonly JsonValue[];
  readonly found: boolean;
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
  const isHit = records.some(recordCarriesTxnArray) || records.some(recordCarriesShapedArray);
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
export function hasTxnArray(body: MaybeJsonValue): HasTxnArray {
  const depths = Array.from({ length: TXN_SCAN_MAX_DEPTH }, (_, i): number => i);
  const initial: IBfsFrontier = { level: [body as JsonValue], found: false };
  const final = depths.reduce((acc): IBfsFrontier => bfsStep(acc), initial);
  return final.found as HasTxnArray;
}

/**
 * Reject URLs whose path matches a known dashboard-PREVIEW / status-
 * page widget pattern from {@link PIPELINE_WELL_KNOWN_API.transactionWidgets}.
 * The picker uses this BEFORE the shape gate so widget endpoints
 * (which pass URL-pattern + body trx-array gates but truncate
 * records at "latest N" per card) never reach SCRAPE. Mission
 * M4.F2: Isracard run `10-05-2026_23355229` lost 17–20 historical
 * txns per card to this cap. Pure predicate — no I/O, single
 * responsibility, bank-agnostic (the WK widget list is the
 * registry source of truth).
 *
 * @param url - Captured endpoint URL.
 * @returns True when the URL matches any known widget pattern.
 */
export function isTxnWidgetUrl(url: string): IsTxnWidgetUrl {
  const isHit = PIPELINE_WELL_KNOWN_API.transactionWidgets.some((p): boolean => p.test(url));
  return isHit as IsTxnWidgetUrl;
}
