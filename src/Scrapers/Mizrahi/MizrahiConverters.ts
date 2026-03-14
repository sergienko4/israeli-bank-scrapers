import moment from 'moment';
import type { Frame } from 'playwright-core';

import { pageEvalAll } from '../../Common/ElementsInteractions.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { SHEKEL_CURRENCY } from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import {
  getTransactionIdentifier,
  type IConvertOneRowOpts,
  type IConvertTxnsOpts,
  type IMoreDetails,
  type IScrapedTransaction,
} from './MizrahiHelpers.js';
import buildSel from './MizrahiSelectors.js';

const SEL = buildSel(SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].selectors);

/** Options for building a single transaction row. */
interface IBuildRowOpts {
  row: IScrapedTransaction;
  txnDate: string;
  moreDetails: IMoreDetails;
  isPendingIfTodayTransaction: boolean;
}

/**
 * Build the base transaction object from a row.
 * @param opts - The row build options.
 * @returns The base ITransaction.
 */
export function buildRowBase(opts: IBuildRowOpts): ITransaction {
  const { row, txnDate, moreDetails, isPendingIfTodayTransaction } = opts;
  const isToday = isPendingIfTodayTransaction && row.IsTodayTransaction;
  return {
    type: TransactionTypes.Normal,
    identifier: getTransactionIdentifier(row),
    date: txnDate,
    processedDate: txnDate,
    originalAmount: row.MC02SchumEZ,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: row.MC02SchumEZ,
    description: row.MC02TnuaTeurEZ,
    memo: moreDetails.memo,
    status: isToday ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

/**
 * Convert a single scraped row to a normalized transaction.
 * @param opts - The conversion options.
 * @returns The normalized ITransaction.
 */
export async function convertOneRow(opts: IConvertOneRowOpts): Promise<ITransaction> {
  const { row, getMoreDetails, isPendingIfTodayTransaction, options } = opts;
  const moreDetails = await getMoreDetails(row);
  const rawDate = row.MC02PeulaTaaEZ;
  const txnDate = moment(rawDate, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();
  const result = buildRowBase({ row, txnDate, moreDetails, isPendingIfTodayTransaction });
  if (options?.includeRawTransaction) {
    const rawData = { ...row, additionalInformation: moreDetails.entries };
    result.rawTransaction = getRawTransaction(rawData);
  }
  return result;
}

/**
 * Convert an array of scraped transactions.
 * @param opts - The batch conversion options.
 * @returns Array of normalized ITransactions.
 */
export async function convertTransactions(opts: IConvertTxnsOpts): Promise<ITransaction[]> {
  const { txns, getMoreDetails, isPendingIfTodayTransaction = false, options } = opts;
  const promises = txns.map(row =>
    convertOneRow({ row, getMoreDetails, isPendingIfTodayTransaction, options }),
  );
  return Promise.all(promises);
}

/** Pending row that could not be parsed. */
interface IEmptyPendingRow {
  isEmpty: true;
}

/**
 * Map a single pending transaction row.
 * @param row - Array of cell text values.
 * @returns The normalized transaction or empty marker.
 */
export function mapPendingRow(row: string[]): ITransaction | IEmptyPendingRow {
  const date = moment(row[0], 'DD/MM/YY').toISOString();
  if (!date) return { isEmpty: true };
  const cleaned = row[3].replaceAll(',', '');
  const amount = parseFloat(cleaned);
  return {
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    originalAmount: amount,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: amount,
    description: row[1],
    status: TransactionStatuses.Pending,
  };
}

/**
 * Check if a mapped pending row is a valid transaction.
 * @param row - The mapped row to check.
 * @returns True if it is a valid ITransaction.
 */
function isValidPendingTxn(row: ITransaction | IEmptyPendingRow): row is ITransaction {
  return !('isEmpty' in row);
}

/**
 * Extract pending transactions from the iframe.
 * @param page - The iframe Frame object.
 * @returns Array of pending ITransactions.
 */
export async function extractPendingTxns(page: Frame): Promise<ITransaction[]> {
  /**
   * Extract cell text from table rows.
   * @param trs - The table row elements.
   * @returns Array of cell text arrays.
   */
  const extractCells = (trs: Element[]): string[][] =>
    trs.map(tr => {
      const cells = tr.querySelectorAll('td');
      return Array.from(cells, td => td.textContent || '');
    });
  const rawRows = await pageEvalAll(page, {
    selector: SEL.pendingTransactionRows,
    defaultResult: [],
    callback: extractCells,
  });
  const mapped = rawRows.map(row => mapPendingRow(row));
  return mapped.filter(isValidPendingTxn);
}
