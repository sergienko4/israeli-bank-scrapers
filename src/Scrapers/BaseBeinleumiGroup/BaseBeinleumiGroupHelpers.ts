import moment from 'moment';
import { type Frame, type Page } from 'playwright-core';

import { elementPresentOnPage, pageEvalAll } from '../../Common/ElementsInteractions.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../Registry/WellKnownSelectors.js';
import type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes.js';
import type { IExtractTxnOpts } from './Interfaces/ExtractTxnOpts.js';
import type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
import type { ITransactionsTr } from './Interfaces/TransactionsTr.js';

export type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes.js';
export type { IExtractTxnOpts } from './Interfaces/ExtractTxnOpts.js';
export type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
export type { ITransactionsTr } from './Interfaces/TransactionsTr.js';

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
 * Parse a currency string into a numeric amount.
 * @param amountStr - Raw amount string with currency symbols.
 * @returns The parsed float value.
 */
function getAmountData(amountStr: string): number {
  const cleaned = amountStr.replace(SHEKEL_CURRENCY_SYMBOL, '').replaceAll(',', '');
  return Number.parseFloat(cleaned);
}

/**
 * Calculate the net amount (credit minus debit) for a scraped transaction.
 * @param txn - The scraped transaction containing credit and debit strings.
 * @returns The net amount as a number.
 */
export function getTxnAmount(txn: IScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

/**
 * Retrieve a single column value from a transaction row.
 * @param tds - The row's cell values indexed by position.
 * @param cols - Column class to index mapping.
 * @param key - The column class name to look up.
 * @returns The trimmed cell text, or empty string if absent.
 */
export function getCol(tds: TransactionsTrTds, cols: TransactionsColsTypes, key: string): string {
  return (tds[cols[key]] || '').trim();
}

/**
 * Build the core transaction fields from a scraped transaction row.
 * @param txn - The scraped transaction data.
 * @returns Transaction fields excluding rawTransaction.
 */
function makeTxnFields(txn: IScrapedTransaction): Omit<ITransaction, 'rawTransaction'> {
  const d = moment(txn.date, DATE_FORMAT).toISOString();
  const amount = getTxnAmount(txn);
  return {
    type: TransactionTypes.Normal,
    identifier: txn.reference ? Number.parseInt(txn.reference, 10) : undefined,
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
 * Build a single ITransaction from a scraped row, optionally including raw data.
 * @param txn - The scraped transaction data.
 * @param options - Optional scraper settings controlling raw-data inclusion.
 * @returns A fully constructed ITransaction.
 */
export function buildSingleTransaction(
  txn: IScrapedTransaction,
  options?: ScraperOptions,
): ITransaction {
  const result: ITransaction = makeTxnFields(txn);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Convert an array of scraped transactions into ITransaction objects.
 * @param txns - The scraped transactions to convert.
 * @param options - Optional scraper settings controlling raw-data inclusion.
 * @returns Array of ITransaction objects.
 */
export function convertTransactions(
  txns: IScrapedTransaction[],
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => buildSingleTransaction(txn, options));
}

/**
 * Extract transaction details from a table row according to its status.
 * @param txnRow - The DOM-scraped table row.
 * @param status - Whether the transaction is completed or pending.
 * @param cols - Column class to index mapping.
 * @returns A structured scraped transaction object.
 */
export function extractTransactionDetails(
  txnRow: ITransactionsTr,
  status: TransactionStatuses,
  cols: TransactionsColsTypes,
): IScrapedTransaction {
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
 * Discover column-type mappings from the first row of a transaction table.
 * @param page - The page or frame containing the table.
 * @param tableLocator - CSS selector for the transaction table.
 * @returns A map of column CSS class to column index.
 */
export async function getTransactionsColsTypeClasses(
  page: Page | Frame,
  tableLocator: string,
): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  /**
   * Map table cells to column class and index pairs.
   * @param tds - The table cells from the first row.
   * @returns Column class and index pairs.
   */
  const extractColClasses = (
    tds: Element[],
  ): { colClass: ReturnType<Element['getAttribute']>; index: number }[] =>
    tds.map((td, index) => ({ colClass: td.getAttribute('class'), index }));
  const typeClassesObjs = await pageEvalAll(page, {
    selector: `${tableLocator} tbody tr:first-of-type td`,
    defaultResult: [] as { colClass: ReturnType<Element['getAttribute']>; index: number }[],
    callback: extractColClasses,
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) result[typeClassObj.colClass] = typeClassObj.index;
  }
  return result;
}

/**
 * Extract a transaction from a row and push it to the accumulator if it has a date.
 * @param opts - Extraction options containing the row, status, columns, and accumulator.
 * @returns True after processing the row.
 */
export function extractTransaction(opts: IExtractTxnOpts): boolean {
  const { txns, transactionStatus, txnRow, transactionsColsTypes } = opts;
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') txns.push(txn);
  return true;
}

/**
 * Check whether the page displays a "no data in date range" message.
 * @param page - The page or frame to inspect.
 * @returns True if the error message is present.
 */
export async function isNoTransactionInDateRangeError(page: Page | Frame): Promise<boolean> {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (!hasErrorInfoElement) return false;
  const errorLoc = page.locator(`.${ERROR_MESSAGE_CLASS}`).first();
  const errorText = await errorLoc.innerText();
  return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
}

/**
 * No-op catch handler — intentionally ignores timeout errors.
 * @returns Always true.
 */
function ignoreTimeout(): boolean {
  return true;
}

/**
 * Wait for the post-login page to finish loading via WELL_KNOWN text detection.
 * @param page - The Playwright page to wait on.
 * @returns True after a post-login element is detected.
 */
export async function waitForPostLogin(page: Page): Promise<boolean> {
  const categories = [
    ...WELL_KNOWN_DASHBOARD_SELECTORS.logoutLink,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.accountSelector,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.dashboardIndicator,
  ];
  const waiters = categories
    .filter(c => c.kind === 'textContent')
    .map(async c => {
      const loc = page.getByText(c.value).first();
      await loc.waitFor({ state: 'visible', timeout: 30000 });
      return true;
    });
  await Promise.race(waiters).catch(ignoreTimeout);
  return true;
}
