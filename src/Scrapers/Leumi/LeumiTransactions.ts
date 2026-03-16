import moment from 'moment';

import { getRawTransaction } from '../../Common/Transactions.js';
import { SHEKEL_CURRENCY } from '../../Constants.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';

/** Raw transaction from Leumi API. */
export interface ILeumiRawTransaction {
  DateUTC: string;
  Description?: string;
  ReferenceNumberLong?: number;
  AdditionalData?: string;
  Amount: number;
}

/** Parsed Leumi account API response. */
export interface ILeumiAccountResponse {
  BalanceDisplay?: string;
  TodayTransactionsItems: ILeumiRawTransaction[] | null;
  HistoryTransactionsItems: ILeumiRawTransaction[] | null;
}

/**
 * Build the base transaction object from a raw Leumi API entry.
 * @param raw - The raw transaction from the API.
 * @param status - The transaction status (pending or completed).
 * @param date - The ISO date string for the transaction.
 * @returns The base ITransaction object.
 */
function buildTxnBase(
  raw: ILeumiRawTransaction,
  status: TransactionStatuses,
  date: string,
): ITransaction {
  return {
    status,
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    description: raw.Description ?? '',
    identifier: raw.ReferenceNumberLong,
    memo: raw.AdditionalData ?? '',
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: raw.Amount,
    originalAmount: raw.Amount,
  };
}

/**
 * Map a single raw transaction to the standard ITransaction format.
 * @param raw - The raw transaction from the API.
 * @param status - The transaction status.
 * @param options - Optional scraper options for raw data inclusion.
 * @returns The mapped ITransaction.
 */
function mapOneTxn(
  raw: ILeumiRawTransaction,
  status: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction {
  const date = moment(raw.DateUTC).milliseconds(0).toISOString();
  const tx = buildTxnBase(raw, status, date);
  if (options?.includeRawTransaction) tx.rawTransaction = getRawTransaction(raw);
  return tx;
}

/**
 * Extract and convert transactions from a single status group.
 * @param transactions - The raw transactions array (may be empty).
 * @param status - The transaction status for this group.
 * @param options - Optional scraper options.
 * @returns The converted ITransaction array.
 */
function extractGroup(
  transactions: ILeumiRawTransaction[],
  status: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction[] {
  if (transactions.length === 0) return [];
  return transactions.map(raw => mapOneTxn(raw, status, options));
}

/**
 * Build the combined pending and completed transaction list.
 * @param response - The parsed account response.
 * @param options - The scraper options.
 * @returns The merged array of pending and completed transactions.
 */
export function buildTxnsFromResponse(
  response: ILeumiAccountResponse,
  options: ScraperOptions,
): ITransaction[] {
  const pending = extractGroup(
    response.TodayTransactionsItems ?? [],
    TransactionStatuses.Pending,
    options,
  );
  const completed = extractGroup(
    response.HistoryTransactionsItems ?? [],
    TransactionStatuses.Completed,
    options,
  );
  return [...pending, ...completed];
}

/**
 * Parse the JSON response string into a typed account response.
 * @param responseJson - The raw response containing a JSON string.
 * @param responseJson.jsonResp - The stringified JSON payload.
 * @returns The parsed ILeumiAccountResponse.
 */
export function parseAccountResponse(responseJson: { jsonResp: string }): ILeumiAccountResponse {
  try {
    return JSON.parse(responseJson.jsonResp) as ILeumiAccountResponse;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScraperError(`Failed to parse Leumi response: ${message}`);
  }
}
