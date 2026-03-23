/**
 * Generic scrape strategy — auto-maps API responses using WellKnown field names.
 * Banks provide ZERO mapping code. The mediator discovers field names automatically.
 * Uses BFS iterative search (max depth 10) — no recursion, no stack overflow.
 */

import moment from 'moment';

import type { ITransaction } from '../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../Transactions.js';
import {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../Registry/PipelineWellKnown.js';

/** Max depth for BFS field search — prevents infinite traversal. */
const MAX_SEARCH_DEPTH = 10;

/** Known date formats across Israeli banks — moment auto-detects. */
const KNOWN_DATE_FORMATS = [
  'YYYYMMDD',
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'YYYY-MM-DDTHH:mm:ss',
  'DD-MM-YYYY',
  'YYYY.MM.DD',
  'DD.MM.YYYY',
  'YYYY.MM.DDTHH:mm:ss',
];

/** BFS queue item for iterative deep search. */
interface ISearchItem {
  readonly value: Record<string, unknown>;
  readonly depth: number;
}

/**
 * Check if a value is a searchable object (not null, not array).
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObject(val: unknown): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Check a single object for a matching WellKnown field.
 * @param record - Object to check.
 * @param fieldNames - WellKnown names.
 * @returns Matched value or false.
 */
function matchFieldInRecord(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | number | false {
  const hit = fieldNames.find((f): boolean => record[f] !== null && record[f] !== undefined);
  if (!hit) return false;
  const val = record[hit];
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val;
  return false;
}

/**
 * Enqueue child objects from a record into the BFS queue.
 * @param record - Parent object.
 * @param depth - Current depth.
 * @param queue - BFS queue to append to.
 * @returns True if children were enqueued.
 */
function enqueueChildren(
  record: Record<string, unknown>,
  depth: number,
  queue: ISearchItem[],
): boolean {
  if (depth >= MAX_SEARCH_DEPTH) return false;
  const children = Object.values(record).filter(isSearchableObject);
  const items = children.map(
    (child): ISearchItem => ({ value: child as Record<string, unknown>, depth: depth + 1 }),
  );
  queue.push(...items);
  return true;
}

/**
 * Build a flat list of all objects in the tree (BFS traversal).
 * @param root - Root object.
 * @returns All objects found at all depths.
 */
function flattenObjectTree(root: Record<string, unknown>): readonly Record<string, unknown>[] {
  const queue: ISearchItem[] = [{ value: root, depth: 0 }];
  let idx = 0;
  while (idx < queue.length) {
    enqueueChildren(queue[idx].value, queue[idx].depth, queue);
    idx += 1;
  }
  return queue.map((item): Record<string, unknown> => item.value);
}

/**
 * Find the first matching field value using BFS iterative deep search.
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
  const hit = results.find((r): boolean => r !== false);
  return hit ?? false;
}

/**
 * Find the first array in an object using BFS (max depth 10).
 * @param obj - Object to search.
 * @returns First array found, or empty array.
 */
function findFirstArray(obj: Record<string, unknown>): readonly unknown[] {
  const allObjects = flattenObjectTree(obj);
  const arrays = allObjects.map((o): readonly unknown[] | false => {
    const arr = Object.values(o).find(Array.isArray);
    return arr ? (arr as readonly unknown[]) : false;
  });
  const hit = arrays.find((a): boolean => a !== false);
  if (!hit) return [];
  return hit;
}

/**
 * Parse a date string using known Israeli bank formats.
 * Moment tries all known formats — no bank config needed.
 * @param dateStr - Raw date string from API response.
 * @returns ISO date string, or original string if no format matches.
 */
function parseAutoDate(dateStr: string): string {
  const parsed = moment(dateStr, KNOWN_DATE_FORMATS, true);
  if (parsed.isValid()) return parsed.toISOString();
  return dateStr;
}

/**
 * Auto-map a raw API transaction to ITransaction using WellKnown field names.
 * Uses BFS deep search for each field concept + auto date parsing.
 * @param raw - Raw transaction object from API response.
 * @returns Mapped ITransaction with best-effort field resolution.
 */
function autoMapTransaction(raw: Record<string, unknown>): ITransaction {
  const date = findFieldValue(raw, WK.date);
  const processedDate = findFieldValue(raw, WK.processedDate);
  const amount = findFieldValue(raw, WK.amount);
  const originalAmount = findFieldValue(raw, WK.originalAmount);
  const description = findFieldValue(raw, WK.description);
  const identifier = findFieldValue(raw, WK.identifier);
  const currency = findFieldValue(raw, WK.currency);
  const dateStr = typeof date === 'string' ? parseAutoDate(date) : '';
  const procStr = typeof processedDate === 'string' ? parseAutoDate(processedDate) : dateStr;
  const amtNum = typeof amount === 'number' ? amount : 0;
  const origNum = typeof originalAmount === 'number' ? originalAmount : amtNum;
  const descStr = typeof description === 'string' ? description : '';
  return {
    type: TransactionTypes.Normal,
    date: dateStr,
    processedDate: procStr,
    originalAmount: origNum,
    originalCurrency: typeof currency === 'string' ? currency : 'ILS',
    chargedAmount: amtNum,
    description: descStr,
    status: TransactionStatuses.Completed,
    identifier: typeof identifier === 'number' ? identifier : undefined,
  };
}

/**
 * Extract account IDs from an API response using BFS deep search.
 * Finds the first array, then searches each element for WellKnown ID fields.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of account ID strings.
 */
function extractAccountIds(responseBody: Record<string, unknown>): readonly string[] {
  const items = findFirstArray(responseBody);
  return items
    .map((item): string => {
      if (!isSearchableObject(item)) return '';
      const id = findFieldValue(item as Record<string, unknown>, WK.accountId);
      return id === false ? '' : String(id);
    })
    .filter(Boolean);
}

/**
 * Extract transactions from an API response using BFS + auto-mapping.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: Record<string, unknown>): readonly ITransaction[] {
  const items = findFirstArray(responseBody);
  return items
    .filter((item): boolean => isSearchableObject(item))
    .map((item): ITransaction => autoMapTransaction(item as Record<string, unknown>));
}

/**
 * Check if a captured POST body indicates monthly iteration.
 * Looks for WellKnown month + year fields in the postData.
 * @param postData - Captured POST body string.
 * @returns True if the endpoint uses monthly fetching.
 */
function isMonthlyEndpoint(postData: string): boolean {
  if (!postData) return false;
  try {
    const body = JSON.parse(postData) as Record<string, unknown>;
    const hasMonth = MF.month.some((f): boolean => body[f] !== undefined);
    const hasYear = MF.year.some((f): boolean => body[f] !== undefined);
    return hasMonth && hasYear;
  } catch {
    return false;
  }
}

/** Options for building a monthly POST body. */
interface IMonthBodyOpts {
  readonly template: string;
  readonly accountId: string;
  readonly month: number;
  readonly year: number;
}

/**
 * Replace a WellKnown field in a parsed body with a new value.
 * @param body - Parsed body object.
 * @param fieldNames - WellKnown field names to look for.
 * @param value - New value to set.
 * @returns True if a field was replaced.
 */
function replaceField(
  body: Record<string, unknown>,
  fieldNames: readonly string[],
  value: string,
): boolean {
  const keys = Object.keys(body);
  const hit = fieldNames.find((f): boolean => keys.includes(f));
  if (!hit) return false;
  body[hit] = value;
  return true;
}

/**
 * Build a POST body for one month from a captured template.
 * Replaces the account ID + month + year fields in the template.
 * @param opts - Month body options with template + values.
 * @returns New POST body as Record.
 */
function buildMonthBody(opts: IMonthBodyOpts): Record<string, unknown> {
  const body = JSON.parse(opts.template) as Record<string, unknown>;
  replaceField(body, MF.accountId, opts.accountId);
  const monthStr = String(opts.month);
  const yearStr = String(opts.year);
  replaceField(body, MF.month, monthStr);
  replaceField(body, MF.year, yearStr);
  return body;
}

export {
  autoMapTransaction,
  buildMonthBody,
  extractAccountIds,
  extractTransactions,
  findFieldValue,
  findFirstArray,
  isMonthlyEndpoint,
  parseAutoDate,
};
