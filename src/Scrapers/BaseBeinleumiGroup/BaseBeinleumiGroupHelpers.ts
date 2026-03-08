import moment from 'moment';
import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage, pageEvalAll } from '../../Common/ElementsInteractions.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes.js';
import type { ExtractTxnOpts } from './Interfaces/ExtractTxnOpts.js';
import type { ScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
import type { TransactionsTr } from './Interfaces/TransactionsTr.js';

export type { TransactionsColsTypes, TransactionsTrTds } from './BaseBeinleumiGroupBaseTypes.js';
export type { ExtractTxnOpts } from './Interfaces/ExtractTxnOpts.js';
export type { ScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
export type { TransactionsTr } from './Interfaces/TransactionsTr.js';

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

function getAmountData(amountStr: string): number {
  return parseFloat(amountStr.replace(SHEKEL_CURRENCY_SYMBOL, '').replaceAll(',', ''));
}

export function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

export function getCol(tds: TransactionsTrTds, cols: TransactionsColsTypes, key: string): string {
  return (tds[cols[key]] || '').trim();
}

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

export function buildSingleTransaction(
  txn: ScrapedTransaction,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = makeTxnFields(txn);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

export function convertTransactions(
  txns: ScrapedTransaction[],
  options?: ScraperOptions,
): Transaction[] {
  return txns.map(txn => buildSingleTransaction(txn, options));
}

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

export async function getTransactionsColsTypeClasses(
  page: Page | Frame,
  tableLocator: string,
): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  const typeClassesObjs = await pageEvalAll(page, {
    selector: `${tableLocator} tbody tr:first-of-type td`,
    defaultResult: [] as { colClass: string | null; index: number }[],
    callback: tds => tds.map((td, index) => ({ colClass: td.getAttribute('class'), index })),
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) result[typeClassObj.colClass] = typeClassObj.index;
  }
  return result;
}

export function extractTransaction(opts: ExtractTxnOpts): void {
  const { txns, transactionStatus, txnRow, transactionsColsTypes } = opts;
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') txns.push(txn);
}

export async function isNoTransactionInDateRangeError(page: Page | Frame): Promise<boolean> {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (!hasErrorInfoElement) return false;
  const errorText = await page.$eval(
    `.${ERROR_MESSAGE_CLASS}`,
    el => (el as HTMLElement).innerText,
  );
  return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
}
