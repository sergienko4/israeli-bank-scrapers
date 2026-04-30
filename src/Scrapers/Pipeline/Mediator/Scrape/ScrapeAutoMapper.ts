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

export type { IMonthChunk } from './ScrapeReplayAction.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from './ScrapeReplayAction.js';

const LOG = getDebug(import.meta.url);

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
 * Numeric inputs are stringified so numeric YYYYMMDD dates survive.
 * @param val - Raw field value from findFieldValue.
 * @param transform - Optional string transform (e.g., parseAutoDate).
 * @param fallback - Fallback when val is missing.
 * @returns Coerced string.
 */
function coerceString(
  val: string | number | false,
  transform?: (s: string) => string,
  fallback = '',
): CoercedStr {
  if (val === false) return fallback;
  let s = '';
  if (typeof val === 'string') s = val;
  if (typeof val === 'number') s = String(val);
  if (s === '') return fallback;
  if (transform) return transform(s);
  return s;
}

/**
 * Coerce a field value to number with fallback.
 * @param val - Raw field value from findFieldValue.
 * @param fallback - Fallback when val is not a number.
 * @returns Coerced number.
 */
function coerceNumber(val: string | number | false, fallback: CoercedNum): CoercedNum {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return fallback;
  const parsed = Number(val);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
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
  const rootHit = matchFieldInRecord(obj, fieldNames);
  if (rootHit !== false) return rootHit;
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
  [
    ...WK.date,
    ...WK.amount,
    ...WK.debitAmount,
    ...WK.creditAmount,
    ...WK.description,
    ...WK.identifier,
  ].map((f): LowercaseKey => f.toLowerCase()),
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
    LOG.debug({ message: `findFirstArray: collected ${String(collected.length)} items` });
    return collected;
  }
  LOG.debug({
    message: 'findFirstArray: falling back to BFS',
  });
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
/** Shekel currency aliases from WK. */
const SHEKEL_ALIASES = new Set(WK.shekelAliases);

/**
 * Normalize currency — convert shekel aliases to standard ILS.
 * @param raw - Raw currency string.
 * @returns Normalized currency code.
 */
/** Currency string from API. */
type CurrencyStr = string;

/**
 * Normalize currency — convert shekel aliases to ILS.
 * @param raw - Raw currency string.
 * @returns Normalized currency code.
 */
function normalizeCurrency(raw: CurrencyStr): CurrencyStr {
  if (SHEKEL_ALIASES.has(raw)) return 'ILS';
  return raw;
}

/**
 * Check if a raw transaction is voided/summary (should be filtered out).
 * Matches old scraper's filterValidTransactions logic:
 * dealSumType === '1' is voided, voucherNumberRatz === '000000000' is invalid.
 * @param raw - Raw transaction record.
 * @returns True if the transaction should be excluded.
 */
function isVoidedTransaction(raw: ApiRecord): Predicate {
  const voidVal = findFieldValue(raw, WK.voidIndicators);
  if (voidVal === '1') return true;
  const voucher = findFieldValue(raw, WK.voucherFields);
  if (voucher === '000000000') return true;
  return false;
}

/**
 * Negate amount for card transactions (charges are debits).
 * Isracard/Amex report positive amounts for charges — old scraper negates them.
 * @param amount - Raw amount from API.
 * @param isCardTxn - Whether this is a card company transaction.
 * @returns Negated amount for cards, original for banks.
 */
function maybeNegateAmount(amount: AmountNum, isCardTxn: IsCardTxn): AmountNum {
  if (!isCardTxn) return amount;
  if (amount === 0) return 0;
  return -Math.abs(amount);
}

/** Whether the transaction is from a card company (amounts should be negated). */
type IsCardTxn = boolean;
/** Numeric amount value. */
type AmountNum = number;

/**
 * Resolve amount — single field or split debit/credit netting.
 * Generic: if WK.amount not found, falls back to credit - debit.
 * @param raw - Raw transaction record.
 * @param singleAmount - Result of findFieldValue(raw, WK.amount).
 * @returns Resolved numeric amount.
 */
function resolveAmount(raw: ApiRecord, singleAmount: string | number | false): AmountNum {
  if (singleAmount !== false) return coerceNumber(singleAmount, 0);
  const debit = findFieldValue(raw, WK.debitAmount);
  const credit = findFieldValue(raw, WK.creditAmount);
  const debitNum = coerceNumber(debit, 0);
  const creditNum = coerceNumber(credit, 0);
  return creditNum - debitNum;
}

/**
 * Apply WK.direction sign convention. Debit indicators flip a positive
 * amount to negative; missing / non-debit directions leave the amount untouched.
 * @param raw - Raw transaction record.
 * @param amount - Amount already resolved via resolveAmount + maybeNegateAmount.
 * @returns Sign-corrected amount.
 */
function applyDirectionWk(raw: ApiRecord, amount: AmountNum): AmountNum {
  const direction = findFieldValue(raw, WK.direction);
  if (typeof direction !== 'string') return amount;
  if (!/^debit$/i.test(direction)) return amount;
  return -Math.abs(amount);
}

/** Guard outcome — txn is well-formed when date + amount parse cleanly. */
type TxnMappable = boolean;

/**
 * Validate a mapped txn before it leaves the auto-mapper.
 * Rejects records with empty date or NaN amount — these would silently
 * drop later in deduplicateTxns / downstream consumers.
 * @param dateIso - Coerced date string (ISO or passthrough).
 * @param amount - Coerced charged amount.
 * @returns True when txn has the minimum required fields.
 */
function isMappableTxn(dateIso: string, amount: CoercedNum): TxnMappable {
  if (dateIso === '') return false;
  if (!Number.isFinite(amount)) return false;
  const ms = new Date(dateIso).getTime();
  if (Number.isNaN(ms)) return false;
  return true;
}

/**
 * Map a raw API record to a standard ITransaction.
 * Returns false when required fields (date / amount) cannot be coerced,
 * so the extractor can drop the record with a LOUD log instead of
 * letting an empty-date / NaN-amount txn propagate silently.
 * @param raw - Raw transaction record from API response.
 * @returns Mapped transaction, or false on malformed record.
 */
function autoMapTransaction(raw: ApiRecord): ITransaction | false {
  const date = findFieldValue(raw, WK.date);
  const processedDate = findFieldValue(raw, WK.processedDate);
  const amount = findFieldValue(raw, WK.amount);
  const originalAmount = findFieldValue(raw, WK.originalAmount);
  const description = findFieldValue(raw, WK.description);
  const identifier = findFieldValue(raw, WK.identifier);
  const currency = findFieldValue(raw, WK.currency);
  const dateStr = coerceString(date, parseAutoDate);
  const procStr = coerceString(processedDate, parseAutoDate, dateStr);
  const voidField = findFieldValue(raw, WK.voidIndicators);
  const isCard = Boolean(voidField);
  const rawAmt = resolveAmount(raw, amount);
  const negAmt = maybeNegateAmount(rawAmt, isCard);
  const amtNum = applyDirectionWk(raw, negAmt);
  if (!isMappableTxn(dateStr, amtNum)) {
    const why = `date="${dateStr}", amount=${String(amtNum)}`;
    LOG.debug({ message: `autoMapTransaction: rejected (${why})` });
    return false;
  }
  const rawOrig = coerceNumber(originalAmount, amtNum);
  const negOrig = maybeNegateAmount(rawOrig, isCard);
  const origNum = applyDirectionWk(raw, negOrig);
  const descStr = coerceString(description);
  const rawCurr = coerceString(currency, undefined, DEFAULT_CURRENCY);
  const currStr = normalizeCurrency(rawCurr);
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

/** Preview length for the raw body trace dump. */
const BODY_PREVIEW_CHARS = 4096;

/** Raw JSON string — output of JSON.stringify. */
type RawJson = string;
/** Truncated preview of a RawJson — caller safe for trace dumps. */
type JsonPreview = string;

/**
 * Stringify a response body, returning a short failure marker on throw.
 * @param body - API body.
 * @returns Full JSON or '<unstringifiable>'.
 */
function safeStringify(body: ApiRecord): RawJson {
  try {
    return JSON.stringify(body);
  } catch {
    return '<unstringifiable>';
  }
}

/**
 * Truncate a JSON string for trace dumps.
 * @param json - Full JSON string.
 * @returns Truncated preview.
 */
function truncatePreview(json: RawJson): JsonPreview {
  if (json.length <= BODY_PREVIEW_CHARS) return json;
  return `${json.slice(0, BODY_PREVIEW_CHARS)}…`;
}

/**
 * Trace-dump the raw response shape when extraction fails. Helps diagnose
 * bank-specific API formats (e.g. Hapoalim) without stopping the pipeline.
 * @param responseBody - The raw API body that yielded zero items.
 * @returns Always true (side-effect only).
 */
function traceRawShape(responseBody: ApiRecord): true {
  const topLevelKeys = Object.keys(responseBody);
  const json = safeStringify(responseBody);
  const preview = truncatePreview(json);
  LOG.trace({
    message: 'extractAccountRecords: 0 items — raw body shape',
    topLevelKeys,
    preview,
  });
  return true;
}

/**
 * Check if a value is a plain object with at least one WK.accountId / .displayId field.
 * Used to recognize account-shape records that don't carry txn-signature fields
 * (e.g. Hapoalim's /general/accounts: [{bankNumber,branchNumber,accountNumber,...}]).
 * @param v - Candidate value.
 * @returns True when v looks like an account record.
 */
function looksLikeAccountRecord(v: UntypedValue): Predicate {
  if (!isSearchableObject(v)) return false;
  const hit = findFieldValue(v as ApiRecord, WK.accountId);
  return hit !== false;
}

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
  const arr = responseBody as readonly UntypedValue[];
  if (arr.length === 0) return [];
  if (!looksLikeAccountRecord(arr[0])) return [];
  return arr.filter(looksLikeAccountRecord).map((v): ApiRecord => v as ApiRecord);
}

/**
 * Extract account records from API response. Logs the response shape at
 * trace level when zero items are found — exposes per-bank mapper gaps.
 * Tries two extractors in order:
 *   1. findFirstArray (txn-signature BFS — covers banks whose account
 *      response has txn preview arrays)
 *   2. rootAccountArray (root-level array of account-shaped records —
 *      covers Hapoalim's /general/accounts)
 * @param responseBody - Parsed JSON response body.
 * @returns Account records with all original fields.
 */
function extractAccountRecords(responseBody: ApiRecord): readonly ApiRecord[] {
  const items = findFirstArray(responseBody);
  if (items.length > 0) {
    LOG.debug({ message: `extractAccountRecords: ${String(items.length)} items` });
    return castSearchable(items);
  }
  const rootAccts = rootAccountArray(responseBody);
  if (rootAccts.length > 0) {
    LOG.debug({
      message: `extractAccountRecords: ${String(rootAccts.length)} items (root-array fallback)`,
    });
    return rootAccts;
  }
  LOG.debug({ message: 'extractAccountRecords: 0 items' });
  traceRawShape(responseBody);
  return [];
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

/** Max depth for transaction hunting. */
const MAX_HUNT_DEPTH = 20;

/** Stack entry for iterative tree walk. */
interface IHuntEntry {
  readonly val: unknown;
  readonly depth: HuntDepth;
}

/** Depth counter for stack walk. */
type HuntDepth = number;

/** Bundled args for array processing. */
interface IHuntArrayArgs {
  readonly objects: readonly unknown[];
  readonly depth: HuntDepth;
  readonly collected: ApiRecord[];
  readonly stack: IHuntEntry[];
}

/**
 * Process one array node — collect if txn-like, else push children.
 * @param args - Bundled hunt array arguments.
 * @returns True if collected.
 */
function processHuntArray(args: IHuntArrayArgs): Predicate {
  const { objects, depth, collected, stack } = args;
  if (objects.length === 0) return false;
  const firstObj = objects[0] as ApiRecord;
  const score = scoreTxnSignature(firstObj);
  if (score >= MIN_TXN_SCORE) {
    collected.push(...(objects as ApiRecord[]));
    return true;
  }
  const children = objects.map((o): IHuntEntry => ({ val: o, depth: depth + 1 }));
  stack.push(...children);
  return false;
}

/**
 * Process one object node — push child values onto stack.
 * @param record - Object to expand.
 * @param depth - Current depth.
 * @param stack - Mutable stack.
 * @returns True after pushing.
 */
function processHuntObject(
  record: Record<string, unknown>,
  depth: HuntDepth,
  stack: IHuntEntry[],
): Predicate {
  const children = Object.values(record)
    .filter((v): Predicate => typeof v === 'object' && v !== null)
    .map((v): IHuntEntry => ({ val: v, depth: depth + 1 }));
  stack.push(...children);
  return true;
}

/**
 * Process one stack entry — dispatch array vs object.
 * @param entry - Entry to process.
 * @param collected - Mutable collector.
 * @param stack - Mutable stack.
 * @returns True if processed.
 */
function processHuntEntry(
  entry: IHuntEntry,
  collected: ApiRecord[],
  stack: IHuntEntry[],
): Predicate {
  if (entry.depth > MAX_HUNT_DEPTH) return false;
  const { val, depth } = entry;
  if (Array.isArray(val)) {
    const objects = (val as unknown[]).filter(
      (v): Predicate => typeof v === 'object' && v !== null,
    );
    return processHuntArray({ objects, depth, collected, stack });
  }
  if (typeof val === 'object' && val !== null) {
    return processHuntObject(val as Record<string, unknown>, depth, stack);
  }
  return false;
}

/**
 * Drain the hunt stack — process entries until empty.
 * @param stack - Mutable stack.
 * @param collected - Mutable collector.
 * @returns Collected transaction items.
 */
function drainHuntStack(stack: IHuntEntry[], collected: ApiRecord[]): readonly ApiRecord[] {
  if (stack.length === 0) return collected;
  const entry = stack.pop();
  if (entry) processHuntEntry(entry, collected, stack);
  return drainHuntStack(stack, collected);
}

/**
 * Stack-based iterative transaction hunter.
 * Walks the response tree. Collects arrays whose items score as transactions.
 * @param responseBody - Raw API response.
 * @returns Flat array of transaction-like items.
 */
function huntTransactions(responseBody: ApiRecord): readonly ApiRecord[] {
  const stack: IHuntEntry[] = [{ val: responseBody, depth: 0 }];
  return drainHuntStack(stack, []);
}

/**
 * Extract transactions from an API response using stack-based iterative hunt.
 * Filters voided/summary rows. Maps to ITransaction.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: ApiRecord): readonly ITransaction[] {
  const items = huntTransactions(responseBody);
  const valid = items.filter((r): Predicate => !isVoidedTransaction(r));
  const mapped = valid.map(autoMapTransaction);
  const kept = mapped.filter((t): t is ITransaction => t !== false);
  const count = String(items.length);
  const validCount = String(valid.length);
  const keptCount = String(kept.length);
  const msg = `huntTransactions: ${count} found, ${validCount} valid, ${keptCount} mapped`;
  LOG.debug({ message: msg });
  return kept;
}

// ── Card-aware extraction (anti-mirroring) ──────────────────────────────

/** Card index identifier for per-card extraction. */
type CardIndexId = string;

/**
 * Step 1: Key-based lookup — find `Index{cardId}` subtree in response.
 * Isracard/Amex pattern: `CardsTransactionsListBean.Index0`, `.Index1`, etc.
 * @param body - API response body.
 * @param cardId - Card index (e.g. '0', '1', '5').
 * @returns Subtree record if found, false otherwise.
 */
function findIndexedSubtree(body: ApiRecord, cardId: CardIndexId): ApiRecord | false {
  const indexKey = `Index${cardId}`;
  const values = Object.values(body);
  const nested = values.filter((v): Predicate => isSearchableObject(v));
  const records = nested.map((v): ApiRecord => v as ApiRecord);
  const match = records.find((rec): Predicate => indexKey in rec);
  if (match) return match[indexKey] as ApiRecord;
  return false;
}

/**
 * Step 2: Value-based BFS — filter transaction items by cardIndex field.
 * @param body - API response body.
 * @param cardId - Card index to match.
 * @returns Filtered transaction items, empty if none matched.
 */
function filterByCardIndex(body: ApiRecord, cardId: CardIndexId): readonly ITransaction[] {
  const allItems = findFirstArray(body);
  const searchable = castSearchable(allItems);
  const matched = searchable.filter((item): Predicate => String(item.cardIndex) === cardId);
  if (matched.length === 0) return [];
  const mapped = matched.map(autoMapTransaction);
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Card-aware extraction — 3-step resolution chain.
 * 1. Key lookup: `Index{cardId}` subtree (Isracard/Amex)
 * 2. Value BFS: filter by `cardIndex` field value
 * 3. Fallback: extract all (single-card response)
 * @param body - API response body.
 * @param cardId - Card index for scoping.
 * @returns Transactions for the specified card only.
 */
function extractTransactionsForCard(body: ApiRecord, cardId: CardIndexId): readonly ITransaction[] {
  const subtree = findIndexedSubtree(body, cardId);
  if (subtree) {
    LOG.debug({ message: `extractForCard: Index${cardId} → key lookup` });
    return extractTransactions(subtree);
  }
  const byValue = filterByCardIndex(body, cardId);
  if (byValue.length > 0) {
    const count = String(byValue.length);
    LOG.debug({ message: `extractForCard: cardIndex=${cardId} → value BFS (${count} txns)` });
    return byValue;
  }
  LOG.warn({
    message: `STRICT_SCOPE: no data for Card ${cardId} — returning empty (no fallback)`,
  });
  return [];
}

export {
  autoMapTransaction,
  extractAccountIds,
  extractAccountRecords,
  extractTransactions,
  extractTransactionsForCard,
  findFieldValue,
  findFirstArray,
  matchField,
  parseAutoDate,
};
