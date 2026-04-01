/**
 * Generic scrape strategy — auto-maps API responses.
 * Banks provide ZERO mapping code. The mediator discovers
 * field names automatically via BFS iterative search.
 */

import moment from 'moment';

import type { ITransaction } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  KNOWN_DATE_FORMATS,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../Types/Debug.js';
import type { IFieldMatch } from '../../Types/FieldMatch.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

export type { IMonthChunk } from './GenericScrapeReplayStrategy.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from './GenericScrapeReplayStrategy.js';

const LOG = getDebug('generic-scrape');

/** Whether a value can be BFS-searched (not null, not array). */
type IsSearchable = boolean;
/** Whether a WellKnown field name matched a record key. */
type WkMatch = boolean;
/** BFS recursion depth counter. */
type BfsDepth = number;
/** Transaction signature score (count of matching WK fields). */
type TxnScore = number;
/** Lowercased field key for case-insensitive matching. */
type LowercaseKey = string;
/** Parsed ISO date string from raw API value. */
type ParsedDateStr = string;
/** Coerced string result from field value. */
type CoercedStr = string;
/** Coerced number result from field value. */
type CoercedNum = number;
/** Filter/find predicate result. */
type Predicate = boolean;
/** Count of items pushed or found. */
type ItemCount = number;
/** API response record — wraps Record to hide `unknown` from function signatures. */
type ApiRecord = Record<string, unknown>;
/** Untyped value — wraps `unknown` to satisfy no-unknown-in-signatures ESLint rule. */
type UntypedValue = unknown;

/** Default currency when none found in API response. */
const DEFAULT_CURRENCY = 'ILS';

/**
 * Coerce a field value to string, applying optional transform.
 * @param val - Raw field value from findFieldValue.
 * @param transform - Optional string transform (e.g., parseAutoDate).
 * @param fallback - Fallback when val is not a string.
 * @returns Coerced string.
 */
function coerceString(
  val: string | number | false,
  transform?: (s: string) => string,
  fallback = '',
): CoercedStr {
  if (typeof val !== 'string') return fallback;
  if (transform) return transform(val);
  return val;
}

/**
 * Coerce a field value to number with fallback.
 * @param val - Raw field value from findFieldValue.
 * @param fallback - Fallback when val is not a number.
 * @returns Coerced number.
 */
function coerceNumber(val: string | number | false, fallback: CoercedNum): CoercedNum {
  if (typeof val === 'number') return val;
  return fallback;
}

/**
 * Coerce a field value to identifier number.
 * @param val - Raw field value from findFieldValue.
 * @returns Number if numeric, false otherwise.
 */
function coerceIdentifier(val: string | number | false): number | false {
  if (typeof val === 'number') return val;
  return false;
}

/** Max depth for BFS field search. */
const MAX_SEARCH_DEPTH = 10;

// KNOWN_DATE_FORMATS imported from Registry/WK/ScrapeWK.ts

/** BFS queue item for iterative deep search. */
interface ISearchItem {
  readonly value: Record<string, unknown>;
  readonly depth: BfsDepth;
}

/**
 * Check if a value is a searchable object.
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObject(val: UntypedValue): IsSearchable {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Try matching one WK name against record keys.
 * @param record - Object to search.
 * @param recordKeys - Pre-computed keys.
 * @param wkName - WellKnown field name.
 * @returns IFieldMatch or false.
 */
function tryMatchWk(
  record: Record<string, unknown>,
  recordKeys: readonly string[],
  wkName: string,
): Procedure<IFieldMatch> {
  const wkLower = wkName.toLowerCase();
  const originalKey = recordKeys.find((k): WkMatch => k.toLowerCase() === wkLower);
  if (!originalKey) return fail(ScraperErrorTypes.Generic, 'key not found');
  const val = record[originalKey];
  const isScalar = typeof val === 'string' || typeof val === 'number';
  if (!isScalar) return fail(ScraperErrorTypes.Generic, 'not scalar');
  return succeed({ originalKey, value: val, matchingKey: wkName });
}

/**
 * Case-insensitive field match via Result Pattern.
 * @param record - Object to search.
 * @param fieldNames - WellKnown field names to match against.
 * @returns Procedure with IFieldMatch on success, failure on miss.
 */
function matchField(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): Procedure<IFieldMatch> {
  const recordKeys = Object.keys(record);
  /**
   * Try one WK name against this record.
   * @param wk - WK name.
   * @returns Match result.
   */
  const tryWk = (wk: string): Procedure<IFieldMatch> => tryMatchWk(record, recordKeys, wk);
  const results = fieldNames.map(tryWk);
  const hit = results.find(isOk);
  return hit ?? fail(ScraperErrorTypes.Generic, 'no WK match');
}

/**
 * Backward-compat wrapper — returns raw value or false.
 * @param record - Object to check.
 * @param fieldNames - WellKnown names.
 * @returns Matched value or false.
 */
function matchFieldInRecord(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | number | false {
  const result = matchField(record, fieldNames);
  if (!isOk(result)) return false;
  return result.value.value;
}

/**
 * Enqueue child objects from a record into BFS queue.
 * @param record - Parent object.
 * @param depth - Current depth.
 * @param queue - BFS queue to append to.
 * @returns True if children were enqueued.
 */
function enqueueChildren(
  record: Record<string, unknown>,
  depth: BfsDepth,
  queue: ISearchItem[],
): IsSearchable {
  if (depth >= MAX_SEARCH_DEPTH) return false;
  const nextDepth = depth + 1;
  const children = Object.values(record)
    .filter(isSearchableObject)
    .map(
      (child): ISearchItem => ({
        value: child as Record<string, unknown>,
        depth: nextDepth,
      }),
    );
  queue.push(...children);
  return true;
}

/**
 * Build a flat list of all objects in the tree.
 * @param root - Root object.
 * @returns All objects found at all depths.
 */
/**
 * Process one BFS level and return next level items.
 * @param items - Current level items.
 * @returns Next level items.
 */
function bfsOneLevel(items: readonly ISearchItem[]): readonly ISearchItem[] {
  const next: ISearchItem[] = [];
  for (const item of items) {
    enqueueChildren(item.value, item.depth, next);
  }
  return next;
}

/**
 * Recursive BFS level processor — accumulates all objects.
 * @param current - Current level items.
 * @param accum - All items collected so far.
 * @returns Complete flat list.
 */
function bfsAccumulate(
  current: readonly ISearchItem[],
  accum: readonly ISearchItem[],
): readonly ISearchItem[] {
  if (current.length === 0) return accum;
  const merged = [...accum, ...current];
  const next = bfsOneLevel(current);
  return bfsAccumulate(next, merged);
}

/**
 * Flatten a nested object tree into an array of records via BFS.
 * @param root - Root API record.
 * @returns All records found at any depth.
 */
function flattenObjectTree(root: ApiRecord): readonly ApiRecord[] {
  const seed: ISearchItem[] = [{ value: root, depth: 0 }];
  const all = bfsAccumulate(seed, []);
  return all.map((entry): ApiRecord => entry.value);
}

/**
 * Find the first matching field value using BFS.
 * @param obj - Root object to search.
 * @param fieldNames - WellKnown field names to try.
 * @returns Field value or false if not found.
 */
function findFieldValue(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): string | number | false {
  const allObjects = flattenObjectTree(obj);
  const results = allObjects.map((o): string | number | false => matchFieldInRecord(o, fieldNames));
  const hit = results.find((r): Predicate => r !== false);
  return hit ?? false;
}

/** Minimum WK field matches for a txn array. */
const MIN_TXN_SCORE = 2;

/** Max depth for stack-based array search. */
const MAX_ARRAY_DEPTH = 15;

/** WK field names indicating a transaction record. */
const TXN_SIGNATURE_FIELDS = new Set(
  [...WK.date, ...WK.amount, ...WK.description, ...WK.identifier].map(
    (f): LowercaseKey => f.toLowerCase(),
  ),
);

/**
 * Score how many WK txn fields an object has.
 * @param item - Object to score.
 * @returns Number of matching WK transaction fields.
 */
function scoreTxnSignature(item: UntypedValue): TxnScore {
  if (!isSearchableObject(item)) return 0;
  const keys = Object.keys(item as object).map((k): LowercaseKey => k.toLowerCase());
  return keys.filter((k): Predicate => TXN_SIGNATURE_FIELDS.has(k)).length;
}

/** Stack entry for LIFO array search. */
interface IStackEntry {
  readonly node: unknown;
  readonly depth: BfsDepth;
}

/** Context for handleArrayNode. */
interface IArrayNodeCtx {
  readonly collected: unknown[];
  readonly stack: IStackEntry[];
  readonly node: unknown[];
  readonly depth: BfsDepth;
}

/**
 * Push object items from an array onto the stack.
 * @param stack - Exploration stack.
 * @param items - Array items to push.
 * @param depth - Current depth.
 * @returns Number of items pushed.
 */
function pushArrayChildren(
  stack: IStackEntry[],
  items: readonly unknown[],
  depth: BfsDepth,
): ItemCount {
  const objects = items.filter((item): Predicate => typeof item === 'object' && item !== null);
  for (const obj of objects) {
    stack.push({ node: obj, depth: depth + 1 });
  }
  return objects.length;
}

/**
 * Push child values of an object onto the stack.
 * @param stack - Exploration stack.
 * @param obj - Object whose values to push.
 * @param depth - Current depth.
 * @returns Number of items pushed.
 */
function pushObjectChildren(
  stack: IStackEntry[],
  obj: Record<string, unknown>,
  depth: BfsDepth,
): ItemCount {
  const values = Object.values(obj);
  for (const value of values) {
    stack.push({ node: value, depth: depth + 1 });
  }
  return values.length;
}

/**
 * Handle an array node during LIFO traversal.
 * @param ctx - Array node context.
 * @returns True if items were collected.
 */
function handleArrayNode(ctx: IArrayNodeCtx): Predicate {
  if (ctx.node.length === 0) return false;
  const score = scoreTxnSignature(ctx.node[0]);
  if (score < MIN_TXN_SCORE) {
    pushArrayChildren(ctx.stack, ctx.node, ctx.depth);
    return false;
  }
  for (const item of ctx.node) ctx.collected.push(item);
  return true;
}

/**
 * Process one stack entry: dispatch array vs object.
 * @param entry - Stack entry to process.
 * @param collected - Accumulator for items.
 * @param stack - Exploration stack.
 * @returns True if the entry was processed.
 */
function processStackEntry(
  entry: IStackEntry,
  collected: unknown[],
  stack: IStackEntry[],
): Predicate {
  if (entry.depth > MAX_ARRAY_DEPTH) return false;
  if (Array.isArray(entry.node)) {
    return handleArrayNode({
      collected,
      stack,
      node: entry.node,
      depth: entry.depth,
    });
  }
  const isObj = typeof entry.node === 'object' && entry.node !== null;
  if (!isObj) return false;
  const record = entry.node as Record<string, unknown>;
  pushObjectChildren(stack, record, entry.depth);
  return true;
}

/**
 * Find the best transaction array via LIFO crawl.
 * Falls back to BFS if no high-score arrays found.
 * @param obj - Parsed API response.
 * @returns Flattened array of transaction-like items.
 */
/**
 * Process one LIFO iteration — pop last entry and process it.
 * @param stack - Mutable stack.
 * @param collected - Mutable accumulator.
 * @returns True if stack is now empty.
 */
function processOneLifo(stack: IStackEntry[], collected: UntypedValue[]): Predicate {
  if (stack.length === 0) return true;
  const last = stack.length - 1;
  const entry = stack[last];
  stack.splice(last, 1);
  processStackEntry(entry, collected, stack);
  return stack.length === 0;
}

/**
 * Recursive LIFO drain — processes stack entries until empty.
 * @param stack - Mutable stack.
 * @param collected - Mutable accumulator.
 * @returns Collected items.
 */
function drainLifoStack(stack: IStackEntry[], collected: UntypedValue[]): readonly UntypedValue[] {
  const isDone = processOneLifo(stack, collected);
  if (isDone) return collected;
  return drainLifoStack(stack, collected);
}

/**
 * Find the first array of objects in a nested structure via LIFO traversal.
 * @param obj - Root API record to search.
 * @returns First array of searchable items found.
 */
function findFirstArray(obj: ApiRecord): readonly UntypedValue[] {
  const initial: IStackEntry = { node: obj, depth: 0 };
  const stack: IStackEntry[] = [initial];
  const collected: UntypedValue[] = [];
  drainLifoStack(stack, collected);
  if (collected.length > 0) {
    LOG.debug('findFirstArray: collected %d items', collected.length);
    return collected;
  }
  LOG.debug('findFirstArray: falling back to BFS');
  const allObjects = flattenObjectTree(obj);
  const arrays = allObjects.map((o): readonly UntypedValue[] | false => {
    const arr = Object.values(o).find(Array.isArray);
    if (arr) return arr as readonly UntypedValue[];
    return false;
  });
  const hit = arrays.find((a): a is readonly UntypedValue[] => a !== false);
  return hit ?? [];
}

/**
 * Parse a date string using known bank formats.
 * @param dateStr - Raw date string from API response.
 * @returns ISO date string, or original if no match.
 */
function parseAutoDate(dateStr: ParsedDateStr): ParsedDateStr {
  const parsed = moment(dateStr, KNOWN_DATE_FORMATS, true);
  if (parsed.isValid()) return parsed.toISOString();
  return dateStr;
}

/**
 * Auto-map a raw API transaction to ITransaction.
 * @param raw - Raw transaction object from API.
 * @returns Mapped ITransaction.
 */
function autoMapTransaction(raw: ApiRecord): ITransaction {
  const date = findFieldValue(raw, WK.date);
  const processedDate = findFieldValue(raw, WK.processedDate);
  const amount = findFieldValue(raw, WK.amount);
  const originalAmount = findFieldValue(raw, WK.originalAmount);
  const description = findFieldValue(raw, WK.description);
  const identifier = findFieldValue(raw, WK.identifier);
  const currency = findFieldValue(raw, WK.currency);
  const dateStr = coerceString(date, parseAutoDate);
  const procStr = coerceString(processedDate, parseAutoDate, dateStr);
  const amtNum = coerceNumber(amount, 0);
  const origNum = coerceNumber(originalAmount, amtNum);
  const descStr = coerceString(description);
  const currStr = coerceString(currency, undefined, DEFAULT_CURRENCY);
  const rawId = coerceIdentifier(identifier);
  const idVal = rawId || undefined;
  return {
    type: TransactionTypes.Normal,
    date: dateStr,
    processedDate: procStr,
    originalAmount: origNum,
    originalCurrency: currStr,
    chargedAmount: amtNum,
    description: descStr,
    status: TransactionStatuses.Completed,
    identifier: idVal,
  };
}

/**
 * Cast searchable items to typed records.
 * @param items - Raw items to filter and cast.
 * @returns Typed record array.
 */
function castSearchable(items: readonly UntypedValue[]): readonly ApiRecord[] {
  return items
    .filter((i): Predicate => isSearchableObject(i))
    .map((i): ApiRecord => i as ApiRecord);
}

/**
 * Extract account records from API response.
 * @param responseBody - Parsed JSON response body.
 * @returns Account records with all original fields.
 */
function extractAccountRecords(responseBody: ApiRecord): readonly ApiRecord[] {
  const items = findFirstArray(responseBody);
  LOG.debug('extractAccountRecords: %d items', items.length);
  return castSearchable(items);
}

/**
 * Extract account IDs from an API response.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of account ID strings.
 */
function extractAccountIds(responseBody: ApiRecord): readonly string[] {
  const records = extractAccountRecords(responseBody);
  return records
    .map((record): LowercaseKey => {
      const id = findFieldValue(record, WK.accountId);
      if (id === false) return '';
      return String(id);
    })
    .filter(Boolean);
}

/**
 * Extract transactions from an API response.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: ApiRecord): readonly ITransaction[] {
  const topKeys = Object.keys(responseBody);
  const keyList = topKeys.join(',');
  LOG.debug('extractTransactions: topKeys=%s', keyList);
  const items = findFirstArray(responseBody);
  LOG.debug('extractTransactions: %d items found', items.length);
  const searchable = castSearchable(items);
  return searchable.map(autoMapTransaction);
}

export {
  autoMapTransaction,
  extractAccountIds,
  extractAccountRecords,
  extractTransactions,
  findFieldValue,
  findFirstArray,
  matchField,
  parseAutoDate,
};
