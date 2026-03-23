/**
 * Generic scrape strategy — auto-maps API responses using WellKnown field names.
 * Banks provide ZERO mapping code. The mediator discovers field names automatically.
 * Works for ALL Israeli banks — Discount, VisaCal, Amex, etc.
 */

import type { ITransaction } from '../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../Transactions.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../Registry/PipelineWellKnown.js';

/**
 * Find the first matching field value from a WellKnown name list.
 * @param obj - Object to search.
 * @param fieldNames - WellKnown field names to try (in priority order).
 * @returns Field value or false if not found.
 */
function findFieldValue(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): string | number | false {
  const hit = fieldNames.find((f): boolean => obj[f] !== null && obj[f] !== undefined);
  if (!hit) return false;
  const val = obj[hit];
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val;
  return false;
}

/**
 * Find the first array in an object (searches up to 3 levels deep).
 * Used to locate the accounts or transactions array in API responses.
 * @param obj - Object to search.
 * @returns First array found, or empty array.
 */
function findFirstArray(obj: Record<string, unknown>): readonly unknown[] {
  const values = Object.values(obj);
  const directArray = values.find(Array.isArray);
  if (directArray) return directArray as readonly unknown[];
  const nestedObj = values.find(
    (v): boolean => typeof v === 'object' && v !== null && !Array.isArray(v),
  );
  if (!nestedObj) return [];
  return findFirstArray(nestedObj as Record<string, unknown>);
}

/**
 * Auto-map a raw API transaction to ITransaction using WellKnown field names.
 * Searches the object for matching field names by concept (date, amount, etc.).
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
  const dateStr = typeof date === 'string' ? date : '';
  const procDateStr = typeof processedDate === 'string' ? processedDate : dateStr;
  const amtNum = typeof amount === 'number' ? amount : 0;
  const origNum = typeof originalAmount === 'number' ? originalAmount : amtNum;
  const descStr = typeof description === 'string' ? description : '';
  const txn: ITransaction = {
    type: TransactionTypes.Normal,
    date: dateStr,
    processedDate: procDateStr,
    originalAmount: origNum,
    originalCurrency: typeof currency === 'string' ? currency : 'ILS',
    chargedAmount: amtNum,
    description: descStr,
    status: TransactionStatuses.Completed,
    identifier: typeof identifier === 'number' ? identifier : undefined,
  };
  return txn;
}

/**
 * Extract account IDs from an API response using WellKnown field names.
 * Finds the first array, then looks for ID-like fields in each element.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of account ID strings.
 */
function extractAccountIds(responseBody: Record<string, unknown>): readonly string[] {
  const items = findFirstArray(responseBody);
  return items
    .map((item): string => {
      if (typeof item !== 'object') return '';
      if (!item) return '';
      const id = findFieldValue(item as Record<string, unknown>, WK.accountId);
      return String(id);
    })
    .filter(Boolean);
}

/**
 * Extract transactions from an API response using WellKnown field names.
 * Finds the first array, then auto-maps each element.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: Record<string, unknown>): readonly ITransaction[] {
  const items = findFirstArray(responseBody);
  return items
    .filter((item): boolean => typeof item === 'object' && item !== null)
    .map((item): ITransaction => autoMapTransaction(item as Record<string, unknown>));
}

export {
  autoMapTransaction,
  extractAccountIds,
  extractTransactions,
  findFieldValue,
  findFirstArray,
};
