/**
 * BALANCE-RESOLVE — balance extractor.
 *
 * Pure-function balance discovery in a captured response body.
 * Implements F2 (bounded BFS to depth 8), F4 (string coercion +
 * Number.isFinite check), and F5 (ILS-first per-currency selection).
 *
 * Uses {@link PIPELINE_BALANCE_ALIASES} — the full WK balance-alias
 * list (16 entries). R-TXN-NOWK seam: this module imports through
 * the standalone export, not through `WK_TXN`.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  ILS_CURRENCY_CODE,
  ILS_CURRENCY_SYMBOL,
  PIPELINE_BALANCE_ALIASES,
  PIPELINE_CURRENCY_DISCRIMINATORS,
} from '../../Registry/WK/BalanceResolveWK.js';
import type { JsonValue } from '../../Types/JsonValue.js';
import { fail, type Procedure, succeed } from '../../Types/Procedure.js';
import { findFieldValue } from '../Scrape/ScrapeAutoMapper.js';

type JsonObject = Record<string, JsonValue>;
type MaybeRecord = JsonObject | null | undefined;

/** Maximum depth for bounded BFS. Empirically covers every captured shape
 * incl. BaNCS-core nested CurrAmt.Amt.Value (Yahav DemandDepositAccount). */
const MAX_BFS_DEPTH = 8;

/**
 * Type guard: value is a plain record (non-null, non-array object).
 * @param v - Value to test.
 * @returns True if v is a record.
 */
export function isRecord(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * F4 — coerce a value to a finite number primitive. Accepts number
 * (must pass Number.isFinite) and string primitives that parseFloat
 * into a finite number. Rejects NaN, ±Infinity, empty / whitespace-
 * only / unparseable strings.
 * @param v - Candidate value.
 * @returns Finite number on success; `false` on rejection.
 */
export function coerceToFiniteNumber(v: JsonValue): number | false {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return false;
  return coerceStringToFinite(v);
}

/**
 * Coerce a string to a finite number. Trims whitespace; rejects
 * empty / NaN-producing inputs. Hoisted so {@link coerceToFiniteNumber}
 * stays at depth 1.
 * @param raw - String to parse.
 * @returns Finite number or false.
 */
function coerceStringToFinite(raw: string): number | false {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const parsed = Number.parseFloat(trimmed);
  if (Number.isFinite(parsed)) return parsed;
  return false;
}

/**
 * Check if a record's currency-discriminator field marks it as ILS.
 * Returns true when `currency === 376` OR currency-symbol equals '₪'.
 * @param record - Record to inspect.
 * @returns True for ILS rows.
 */
function isILSRow(record: JsonObject): boolean {
  const currency = findFieldValue(record, PIPELINE_CURRENCY_DISCRIMINATORS);
  if (currency === ILS_CURRENCY_CODE) return true;
  return currency === ILS_CURRENCY_SYMBOL;
}

/**
 * Try to match a balance alias on a single record and coerce the
 * result to a finite number. Returns the number on success, `false`
 * otherwise.
 * @param record - Record to inspect.
 * @param aliases - Balance alias list.
 * @returns Finite balance or false.
 */
function matchBalanceInRecord(record: JsonObject, aliases: readonly string[]): number | false {
  const balanceHit = findFieldValue(record, aliases);
  if (balanceHit === false) return false;
  return coerceToFiniteNumber(balanceHit);
}

/**
 * Pass 1 of {@link scanArrayILSFirst}: prefer ILS-flagged records.
 * @param records - Candidate records.
 * @param aliases - Balance alias list.
 * @returns First ILS match or false.
 */
function scanIlsRows(records: readonly JsonObject[], aliases: readonly string[]): number | false {
  const ilsRows = records.filter(isILSRow);
  const hits = ilsRows.map((r): number | false => matchBalanceInRecord(r, aliases));
  return hits.find((v): v is number => v !== false) ?? false;
}

/**
 * Pass 2 of {@link scanArrayILSFirst}: any record with non-zero balance.
 * @param records - Candidate records.
 * @param aliases - Balance alias list.
 * @returns First non-zero match or false.
 */
function scanNonZeroRows(
  records: readonly JsonObject[],
  aliases: readonly string[],
): number | false {
  const hits = records.map((r): number | false => matchBalanceInRecord(r, aliases));
  return hits.find((v): v is number => v !== false && v !== 0) ?? false;
}

/**
 * Pass 3 of {@link scanArrayILSFirst}: any record with a balance hit.
 * @param records - Candidate records.
 * @param aliases - Balance alias list.
 * @returns First match (zero allowed) or false.
 */
function scanAnyRow(records: readonly JsonObject[], aliases: readonly string[]): number | false {
  const hits = records.map((r): number | false => matchBalanceInRecord(r, aliases));
  return hits.find((v): v is number => v !== false) ?? false;
}

/**
 * F5 — scan an array of records with ILS-first preference. Three
 * passes: ILS-only → any non-zero → any (zero allowed).
 * @param arr - Array of candidate JSON values.
 * @param aliases - Balance alias list.
 * @returns First finite balance found, or false.
 */
function scanArrayILSFirst(arr: readonly JsonValue[], aliases: readonly string[]): number | false {
  const records = arr.filter(isRecord);
  const ils = scanIlsRows(records, aliases);
  if (ils !== false) return ils;
  const nonZero = scanNonZeroRows(records, aliases);
  if (nonZero !== false) return nonZero;
  return scanAnyRow(records, aliases);
}

/** Args bundle for {@link descendNode} — keeps function signatures ≤3 params. */
interface IDescendArgs {
  readonly aliases: readonly string[];
  readonly depth: number;
  readonly maxDepth: number;
}

/**
 * Recursive helper for {@link runBalanceExtractor}. Returns first
 * finite number found, or false after exhausting the bounded search.
 * @param node - Current JSON node.
 * @param args - Aliases, depth, maxDepth bundle.
 * @returns First finite balance found, or false.
 */
function descendNode(node: JsonValue, args: IDescendArgs): number | false {
  if (args.depth > args.maxDepth) return false;
  if (isRecord(node)) return descendRecord(node, args);
  if (Array.isArray(node)) return descendArray(node, args);
  return false;
}

/**
 * Descend into a record: try direct alias hit at this level, then
 * recurse into each child.
 * @param record - JSON object.
 * @param args - Descend args.
 * @returns First finite balance found, or false.
 */
function descendRecord(record: JsonObject, args: IDescendArgs): number | false {
  const directHit = matchBalanceInRecord(record, args.aliases);
  if (directHit !== false) return directHit;
  const children = Object.values(record);
  const nextArgs: IDescendArgs = { ...args, depth: args.depth + 1 };
  const hits = children.map((c): number | false => descendNode(c, nextArgs));
  return hits.find((v): v is number => v !== false) ?? false;
}

/**
 * Descend into an array: try ILS-first scan at this level, then
 * recurse into each child for deeper nested shapes.
 * @param arr - JSON array.
 * @param args - Descend args.
 * @returns First finite balance found, or false.
 */
function descendArray(arr: readonly JsonValue[], args: IDescendArgs): number | false {
  const ilsHit = scanArrayILSFirst(arr, args.aliases);
  if (ilsHit !== false) return ilsHit;
  const nextArgs: IDescendArgs = { ...args, depth: args.depth + 1 };
  const hits = arr.map((c): number | false => descendNode(c, nextArgs));
  return hits.find((v): v is number => v !== false) ?? false;
}

/**
 * F2 — bounded-depth BFS for balance discovery. Walks the JSON
 * tree to depth ≤ {@link MAX_BFS_DEPTH}, returns the first finite
 * balance value found. Stop-early on hit; bounded by maxDepth.
 *
 * Public entry point. Pure function — no side effects, never throws.
 * @param body - JSON response body (or arbitrary JsonValue).
 * @returns Finite balance number, or `false` when nothing matched.
 */
export function runBalanceExtractor(body: JsonValue): number | false {
  const args: IDescendArgs = {
    aliases: PIPELINE_BALANCE_ALIASES,
    depth: 0,
    maxDepth: MAX_BFS_DEPTH,
  };
  return descendNode(body, args);
}

/**
 * Resolve balance from a captured account record using the supplied
 * alias list. Back-compat seam for legacy callers that pass an
 * explicit alias-list parameter.
 * @param record - Captured account record (or nullish).
 * @param aliases - Balance alias list (empty = no match).
 * @returns Balance number or false when no field match.
 */
export function resolveRecordBalance(
  record: MaybeRecord,
  aliases: readonly string[],
): number | false {
  if (record === null || record === undefined) return false;
  if (!isRecord(record)) return false;
  if (aliases.length === 0) return false;
  const args: IDescendArgs = { aliases, depth: 0, maxDepth: MAX_BFS_DEPTH };
  return descendNode(record, args);
}

/** Error message when no captured record yields a balance. */
const NO_BALANCE_IN_RECORDS = 'no balance field in any captured record';

/**
 * Scan a list of captured response records for the first balance match
 * under the supplied alias list. Procedure wrapper for Result-pattern
 * consumers.
 * @param records - Captured response bodies, in capture order.
 * @param aliases - Balance alias list (empty = no match).
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
