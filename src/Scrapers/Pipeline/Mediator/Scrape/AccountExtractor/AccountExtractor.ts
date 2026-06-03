/**
 * Account extractor — turns an API response body into a list of
 * validated account/card identifiers. Composes the
 * ContainerClaim suffix-matcher, the LIFO findFirstArray fallback,
 * and a root-array fallback for banks like Hapoalim whose
 * `/general/accounts` response is itself an array of account
 * records.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { findFieldValue } from '../BfsFieldSearch/BfsFieldSearch.js';
import { castSearchable } from '../BfsFieldSearch/TxnSignature.js';
import findFirstArray from '../FieldHunt/LifoCrawl.js';
import {
  extractAllContainers,
  flattenContainersForLog,
  looksLikeAccountRecord,
} from './ContainerClaim.js';
import traceRawShape from './RawShapeTrace.js';

const LOG = getDebug(import.meta.url);

/**
 * Root-array fallback: if the response body is already an array of
 * account-shaped records, return it directly. Covers responses like
 * Hapoalim's /general/accounts which is [{bankNumber,accountNumber,…}]
 * at root with no txn-signature fields to trip findFirstArray.
 * @param responseBody - Parsed JSON response body.
 * @returns Root array of account records, or empty.
 */
function rootAccountArray(responseBody: ApiRecord): readonly ApiRecord[] {
  if (!Array.isArray(responseBody)) return [];
  const arr = responseBody as readonly unknown[];
  if (arr.length === 0) return [];
  if (!looksLikeAccountRecord(arr[0])) return [];
  return arr.filter(looksLikeAccountRecord).map((v): ApiRecord => v as ApiRecord);
}

/** Sentinel for `tryFindFirstArrayItems` — returns the empty list. */
const EMPTY_API_LIST: readonly ApiRecord[] = [];

/**
 * Try the BFS findFirstArray + trace-log path. Logs the item count
 * at debug when a hit lands; returns the empty sentinel otherwise.
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Cast records, or {@link EMPTY_API_LIST} on miss.
 */
function tryFindFirstArrayItems(responseBody: ApiRecord): readonly ApiRecord[] {
  const items = findFirstArray(responseBody);
  if (items.length === 0) return EMPTY_API_LIST;
  LOG.debug({ message: `extractAccountRecords: ${String(items.length)} items` });
  return castSearchable(items);
}

/**
 * Try the root-level array fallback. Logs the item count with the
 * `(root-array fallback)` suffix; returns the empty sentinel on miss.
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Root-level accounts, or {@link EMPTY_API_LIST} on miss.
 */
function tryRootAccountArray(responseBody: ApiRecord): readonly ApiRecord[] {
  const rootAccts = rootAccountArray(responseBody);
  if (rootAccts.length === 0) return EMPTY_API_LIST;
  const message = `extractAccountRecords: ${String(rootAccts.length)} items (root-array fallback)`;
  LOG.debug({ message });
  return rootAccts;
}

/**
 * Emit the zero-items debug + raw shape trace fired when none of the
 * three extractors landed a hit. Pulled out so
 * {@link extractAccountRecords} stays within the per-function LoC
 * budget.
 *
 * @param responseBody - Parsed JSON response body for the trace.
 * @returns Always true (sentinel for callers).
 */
function emitZeroItemsTrace(responseBody: ApiRecord): true {
  LOG.debug({ message: 'extractAccountRecords: 0 items' });
  traceRawShape(responseBody);
  return true;
}

/**
 * Extract account records from API response. Logs the response shape
 * at trace level when zero items are found — exposes per-bank mapper
 * gaps. Tries three extractors in order: named WK_ACCT.containers,
 * txn-signature BFS findFirstArray, then root-level array fallback.
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Account records with all original fields.
 */
function extractAccountRecords(responseBody: ApiRecord): readonly ApiRecord[] {
  const containers = extractAllContainers(responseBody);
  if (Object.keys(containers).length > 0) return flattenContainersForLog(containers);
  const fromArray = tryFindFirstArrayItems(responseBody);
  if (fromArray.length > 0) return fromArray;
  const fromRoot = tryRootAccountArray(responseBody);
  if (fromRoot.length > 0) return fromRoot;
  emitZeroItemsTrace(responseBody);
  return [];
}

/**
 * Returns true when {@link id} is a real, server-accepted identifier
 * rather than a position index, sentinel, or stringification artifact.
 * @param id - Candidate identifier string.
 * @returns True iff `id` is acceptable as a transaction-API query parameter.
 */
function isUsableIdentifier(id: string): boolean {
  if (id.length < 2) return false;
  if (id === 'default') return false;
  if (id === 'null') return false;
  if (id === 'undefined') return false;
  return true;
}

/**
 * Resolves a single field name to a usable identifier within a record,
 * or returns the empty-string sentinel when the field is missing or
 * its value fails {@link isUsableIdentifier}.
 * @param record - One account/card record.
 * @param field - Single WK identifier field name to probe.
 * @returns Validated identifier or empty string.
 */
function pickIdFromField(record: ApiRecord, field: string): string {
  const value = findFieldValue(record, [field]);
  if (value === false) return '';
  const str = String(value);
  if (!isUsableIdentifier(str)) return '';
  return str;
}

/**
 * Resolves a single record to a usable identifier by walking
 * `WK_ACCT.id` (queryId fields, then displayId fields) and
 * returning the first value that passes {@link isUsableIdentifier}.
 * @param record - One account/card record.
 * @returns First usable identifier, or empty-string sentinel.
 */
function extractValidIdentifier(record: ApiRecord): string {
  const candidates = WK_ACCT.id.map((field): string => pickIdFromField(record, field));
  return candidates.find(Boolean) ?? '';
}

/**
 * Extracts validated account identifiers from an API response.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of usable identifier strings.
 */
function extractAccountIds(responseBody: ApiRecord): readonly string[] {
  const records = extractAccountRecords(responseBody);
  return records.map(extractValidIdentifier).filter(Boolean);
}

export { extractAccountIds, extractAccountRecords, extractAllContainers, isUsableIdentifier };
