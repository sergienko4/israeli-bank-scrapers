/**
 * Balance resolution from captured account records.
 * Phase 7f follow-up: the balance-alias list comes from the slim
 * `ITxnEndpoint.fieldMap.balance` resolved by DASHBOARD.FINAL — SCRAPE
 * has zero `WK_TXN` access. Callers pass the resolved alias as a
 * single-element list; an empty list (when DASHBOARD's fieldMap had
 * no balance alias) yields no match across all paths, deterministic
 * by design.
 *
 * <p>Generic — no bank-specific branches. The cross-endpoint scan
 * (`resolveBalanceFromRecords`) walks every captured body using the
 * same one-alias contract; banks whose balance lives under a
 * different alias on a sibling endpoint return 0 (the conservative
 * fallback). This is the deliberate consequence of removing WK_TXN
 * from SCRAPE: balance alias resolution is DASHBOARD's responsibility
 * via `ITxnEndpoint.fieldMap`.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { findFieldValue } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonValue, MaybeJsonValue } from '../../../Types/Json.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

type JsonObject = Record<string, JsonValue>;
type MaybeRecord = JsonObject | null | undefined;

/**
 * Type guard: value is a plain record (non-null, non-array object).
 * @param v - Value to test.
 * @returns True if v is a record.
 */
export function isRecord(v: MaybeJsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Scan each object in an array for a balance-alias field hit.
 * @param arr - Candidate array.
 * @param aliases - Resolved balance aliases (typically one entry from
 *   `fc.txnEndpoint.fieldMap.balance`); empty array yields no match.
 * @returns Number balance or false.
 */
function scanArrayForBalance(
  arr: readonly JsonValue[],
  aliases: readonly string[],
): number | false {
  const hits = arr
    .filter((item): item is JsonObject => isRecord(item))
    .map((item): string | number | false => findFieldValue(item, aliases))
    .find((v): v is number => typeof v === 'number');
  return hits ?? false;
}

/**
 * Descend one level into top-level arrays — ScrapeAutoMapper BFS skips arrays.
 * @param record - Parent record.
 * @param aliases - Resolved balance aliases.
 * @returns First balance found in any top-level array, or false.
 */
function descendIntoArrays(record: JsonObject, aliases: readonly string[]): number | false {
  const arrayFields = Object.values(record).filter((v): v is readonly JsonValue[] =>
    Array.isArray(v),
  );
  const hits = arrayFields
    .map((arr): number | false => scanArrayForBalance(arr, aliases))
    .find((v): v is number => v !== false);
  return hits ?? false;
}

/**
 * Descend into top-level record children (objects) and their arrays.
 * @param record - Parent record.
 * @param aliases - Resolved balance aliases.
 * @returns First nested array-balance hit or false.
 */
function descendNested(record: JsonObject, aliases: readonly string[]): number | false {
  const objectFields = Object.values(record).filter(isRecord);
  const hits = objectFields
    .map((child): number | false => descendIntoArrays(child, aliases))
    .find((v): v is number => v !== false);
  return hits ?? false;
}

/**
 * Resolve balance from a captured account record using the supplied
 * alias list (typically a single alias from
 * `fc.txnEndpoint.fieldMap.balance`).
 * Priority: root field → first matching top-level-array record → nested-object-array.
 * @param record - Captured account record (or nullish).
 * @param aliases - Resolved balance aliases (empty = no match).
 * @returns Balance number or false when no field match.
 */
export function resolveRecordBalance(
  record: MaybeRecord,
  aliases: readonly string[],
): number | false {
  if (!isRecord(record)) return false;
  if (aliases.length === 0) return false;
  const rootHit = findFieldValue(record, aliases);
  if (typeof rootHit === 'number') return rootHit;
  const arrayHit = descendIntoArrays(record, aliases);
  if (arrayHit !== false) return arrayHit;
  return descendNested(record, aliases);
}

/** Error message when no captured record yields a balance. */
const NO_BALANCE_IN_RECORDS = 'no balance field in any captured record';

/**
 * Scan a list of captured response records for the first balance match
 * under the supplied alias list.
 *
 * <p>Phase 7f follow-up: the alias list comes from
 * `ctx.txnEndpoint.fieldMap.balance` (DASHBOARD-resolved), not from
 * `WK_TXN.balance`. SCRAPE has zero WK access. Banks whose balance
 * appears on a sibling endpoint under a different alias return 0
 * (deterministic conservative fallback) — the trade-off for clean
 * cross-phase separation. Rule #15: Procedure.
 *
 * @param records - Captured response bodies, in capture order.
 * @param aliases - Resolved balance aliases (empty = no match).
 * @returns Procedure wrapping the balance value or fail when no match.
 */
export function resolveBalanceFromRecords(
  records: readonly MaybeRecord[],
  aliases: readonly string[],
): Procedure<number> {
  const hit = records
    .map((r): number | false => resolveRecordBalance(r, aliases))
    .find((v): v is number => v !== false);
  if (typeof hit === 'number') return succeed(hit);
  return fail(ScraperErrorTypes.Generic, NO_BALANCE_IN_RECORDS);
}
