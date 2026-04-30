/**
 * Balance resolution from captured account records.
 * Tries the WK.balance field list at root, then descends into top-level arrays.
 * Generic — no bank-specific branches.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { findFieldValue } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

type JsonValue = unknown;
type JsonObject = Record<string, JsonValue>;
type MaybeRecord = JsonObject | null | undefined;

/**
 * Type guard: value is a plain record (non-null, non-array object).
 * @param v - Value to test.
 * @returns True if v is a record.
 */
export function isRecord(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Scan each object in an array for a WK.balance field hit.
 * @param arr - Candidate array.
 * @returns Number balance or false.
 */
function scanArrayForBalance(arr: readonly JsonValue[]): number | false {
  const hits = arr
    .filter((item): item is JsonObject => isRecord(item))
    .map((item): string | number | false => findFieldValue(item, WK.balance))
    .find((v): v is number => typeof v === 'number');
  return hits ?? false;
}

/**
 * Descend one level into top-level arrays — ScrapeAutoMapper BFS skips arrays.
 * @param record - Parent record.
 * @returns First balance found in any top-level array, or false.
 */
function descendIntoArrays(record: JsonObject): number | false {
  const arrayFields = Object.values(record).filter((v): v is readonly JsonValue[] =>
    Array.isArray(v),
  );
  const hits = arrayFields
    .map((arr): number | false => scanArrayForBalance(arr))
    .find((v): v is number => v !== false);
  return hits ?? false;
}

/**
 * Descend into top-level record children (objects) and their arrays.
 * @param record - Parent record.
 * @returns First nested array-balance hit or false.
 */
function descendNested(record: JsonObject): number | false {
  const objectFields = Object.values(record).filter(isRecord);
  const hits = objectFields
    .map((child): number | false => descendIntoArrays(child))
    .find((v): v is number => v !== false);
  return hits ?? false;
}

/**
 * Resolve balance from a captured account record.
 * Priority: root field → first matching top-level-array record → nested-object-array.
 * @param record - Captured account record (or nullish).
 * @returns Balance number or false when no field match.
 */
export function resolveRecordBalance(record: MaybeRecord): number | false {
  if (!isRecord(record)) return false;
  const rootHit = findFieldValue(record, WK.balance);
  if (typeof rootHit === 'number') return rootHit;
  const arrayHit = descendIntoArrays(record);
  if (arrayHit !== false) return arrayHit;
  return descendNested(record);
}

/** Error message when no captured record yields a balance. */
const NO_BALANCE_IN_RECORDS = 'no balance field in any captured record';

/**
 * Scan a list of captured response records for the first balance match.
 * Use when the primary txn record lacks a balance but a sibling endpoint
 * (e.g. /accountSummary, /balances/...) contains it. Rule #15: Procedure.
 * @param records - Captured response bodies, in capture order.
 * @returns Procedure wrapping the balance value or fail when no match.
 */
export function resolveBalanceFromRecords(records: readonly MaybeRecord[]): Procedure<number> {
  const hit = records
    .map((r): number | false => resolveRecordBalance(r))
    .find((v): v is number => v !== false);
  if (typeof hit === 'number') return succeed(hit);
  return fail(ScraperErrorTypes.Generic, NO_BALANCE_IN_RECORDS);
}
