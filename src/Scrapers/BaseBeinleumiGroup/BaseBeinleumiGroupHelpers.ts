import moment from 'moment';
import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage, pageEvalAll } from '../../Common/ElementsInteractions';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import type { ExtractTxnOpts } from '../../Interfaces/Banks/BeinleumiGroup/ExtractTxnOpts';
import type { ScrapedTransaction } from '../../Interfaces/Banks/BeinleumiGroup/ScrapedTransaction';
import type { TransactionsTr } from '../../Interfaces/Banks/BeinleumiGroup/TransactionsTr';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes';

export type { ExtractTxnOpts } from '../../Interfaces/Banks/BeinleumiGroup/ExtractTxnOpts';
export type { ScrapedTransaction } from '../../Interfaces/Banks/BeinleumiGroup/ScrapedTransaction';
export type { TransactionsTr } from '../../Interfaces/Banks/BeinleumiGroup/TransactionsTr';
export type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes';

export const DATE_FORMAT = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi].format.date;
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
// Column class strings are stable HTML class names used to identify table columns.
// They are not CSS query selectors, so they live here rather than in ScraperConfig.
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
export const ERROR_MESSAGE_CLASS = 'NO_DATA';

/**
 * Parses a Hebrew-formatted amount string to a floating-point number.
 *
 * @param amountStr - the raw amount string (e.g. '₪1,234.56')
 * @returns the numeric amount value
 */
function getAmountData(amountStr: string): number {
  const normalizedAmount = amountStr.replace(SHEKEL_CURRENCY_SYMBOL, '').replaceAll(',', '');
  return parseFloat(normalizedAmount);
}

/**
 * Calculates the net transaction amount from credit and debit fields.
 *
 * @param txn - the scraped transaction with credit and debit string values
 * @returns the net amount (credit - debit) as a number
 */
export function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

/**
 * Retrieves a cell value from a transaction row by column class name.
 *
 * @param tds - the array of cell text values indexed by column position
 * @param cols - a map of column class names to their column indices
 * @param key - the column class name to look up
 * @returns the trimmed cell text, or an empty string if the column is absent
 */
export function getCol(tds: TransactionsTrTds, cols: TransactionsColsTypes, key: string): string {
  return (tds[cols[key]] || '').trim();
}

/**
 * Converts a scraped transaction into the normalized Transaction field set (without rawTransaction).
 *
 * @param txn - the raw scraped transaction data
 * @returns a Transaction object without the rawTransaction field
 */
function makeTxnFields(txn: ScrapedTransaction): Omit<Transaction, 'rawTransaction'> {
  const d = moment(txn.date, DATE_FORMAT).toISOString();
  const amount = getTxnAmount(txn);
  return {
    type: TransactionTypes.Normal,
    identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
    date: d,
    processedDate: d,
    originalAmount: amount,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: amount,
    status: txn.status,
    description: txn.description,
    memo: txn.memo,
  };
}

/**
 * Builds a fully normalized Transaction from a scraped row, optionally including rawTransaction.
 *
 * @param txn - the raw scraped transaction data
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a complete Transaction object
 */
export function buildSingleTransaction(
  txn: ScrapedTransaction,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = makeTxnFields(txn);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Converts an array of scraped transactions to normalized Transaction objects.
 *
 * @param txns - array of raw scraped transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns array of normalized Transaction objects
 */
export function convertTransactions(
  txns: ScrapedTransaction[],
  options?: ScraperOptions,
): Transaction[] {
  return txns.map(txn => buildSingleTransaction(txn, options));
}

/**
 * Extracts a ScrapedTransaction from a single table row using column class mappings.
 *
 * @param txnRow - the raw table row data with inner cell texts
 * @param status - whether this is a pending or completed transaction
 * @param cols - column class-to-index mappings for this table
 * @returns the extracted ScrapedTransaction object
 */
export function extractTransactionDetails(
  txnRow: TransactionsTr,
  status: TransactionStatuses,
  cols: TransactionsColsTypes,
): ScrapedTransaction {
  const tds = txnRow.innerTds;
  const isCompleted = status === TransactionStatuses.Completed;
  return {
    status,
    date: isCompleted
      ? getCol(tds, cols, DATE_COLUMN_CLASS_COMPLETED)
      : getCol(tds, cols, DATE_COLUMN_CLASS_PENDING),
    description: isCompleted
      ? getCol(tds, cols, DESCRIPTION_COLUMN_CLASS_COMPLETED)
      : getCol(tds, cols, DESCRIPTION_COLUMN_CLASS_PENDING),
    reference: getCol(tds, cols, REFERENCE_COLUMN_CLASS),
    debit: getCol(tds, cols, DEBIT_COLUMN_CLASS),
    credit: getCol(tds, cols, CREDIT_COLUMN_CLASS),
  };
}

/**
 * Reads the column class-to-index mapping from the first row of the transactions table.
 *
 * @param page - the page or frame containing the transactions table
 * @param tableLocator - CSS selector for the transactions table
 * @returns a mapping of column class names to their zero-based column indices
 */
export async function getTransactionsColsTypeClasses(
  page: Page | Frame,
  tableLocator: string,
): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  const typeClassesObjs = await pageEvalAll(page, {
    selector: `${tableLocator} tbody tr:first-of-type td`,
    defaultResult: [] as { colClass: string | null; index: number }[],
    /**
     * Maps each header cell to its class name and column index.
     *
     * @param tds - the array of td elements from the first row of the table
     * @returns an array of objects with colClass and index for each cell
     */
    callback: tds => tds.map((td, index) => ({ colClass: td.getAttribute('class'), index })),
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) result[typeClassObj.colClass] = typeClassObj.index;
  }
  return result;
}

/**
 * Extracts a transaction from a table row and appends it to the accumulator if the date is present.
 *
 * @param opts - extraction options containing the accumulator, status, row data, and column mappings
 */
export function extractTransaction(opts: ExtractTxnOpts): void {
  const { txns, transactionStatus, txnRow, transactionsColsTypes } = opts;
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') txns.push(txn);
}

/**
 * Checks whether the page shows a "no transactions in date range" error message.
 *
 * @param page - the page or frame to inspect for the error element
 * @returns true if the Hebrew "no data" error text is displayed
 */
export async function isNoTransactionInDateRangeError(page: Page | Frame): Promise<boolean> {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (!hasErrorInfoElement) return false;
  const errorText = await page.$eval(
    `.${ERROR_MESSAGE_CLASS}`,
    el => (el as HTMLElement).innerText,
  );
  return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
}
