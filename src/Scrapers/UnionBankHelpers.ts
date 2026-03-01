import moment from 'moment';

import { SHEKEL_CURRENCY } from '../Constants';
import { getRawTransaction } from '../Helpers/Transactions';
import { type Transaction, type TransactionStatuses, TransactionTypes } from '../Transactions';
import { type ScraperOptions } from './Interface';

export const DATE_FORMAT = 'DD/MM/YY';
export const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';
export const DATE_HEADER = 'תאריך';
export const DESCRIPTION_HEADER = 'תיאור';
export const REFERENCE_HEADER = 'אסמכתא';
export const DEBIT_HEADER = 'חובה';
export const CREDIT_HEADER = 'זכות';
export const PENDING_TRANSACTIONS_TABLE_ID = 'trTodayActivityNapaTableUpper';
export const COMPLETED_TRANSACTIONS_TABLE_ID = 'ctlActivityTable';
export const ERROR_MESSAGE_CLASS = 'errInfo';
export const ACCOUNTS_DROPDOWN_SELECTOR = 'select#ddlAccounts_m_ddl';

export interface ScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

export type TransactionTableHeaders = Record<string, number>;
export type TransactionsTrTds = string[];
export interface TransactionsTr {
  id: string;
  innerTds: TransactionsTrTds;
}

function getAmountData(amountStr: string): number {
  return parseFloat(amountStr.replace(',', ''));
}

export function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

export function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
  const convertedAmount = getTxnAmount(txn);
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
    date: convertedDate,
    processedDate: convertedDate,
    originalAmount: convertedAmount,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: convertedAmount,
    status: txn.status,
    description: txn.description,
    memo: txn.memo,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

export function convertTransactions(
  txns: ScrapedTransaction[],
  options?: ScraperOptions,
): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

export function getTransactionDate(tds: TransactionsTrTds, hdrs: TransactionTableHeaders): string {
  return (tds[hdrs[DATE_HEADER]] || '').trim();
}

export function getTransactionDescription(
  tds: TransactionsTrTds,
  hdrs: TransactionTableHeaders,
): string {
  return (tds[hdrs[DESCRIPTION_HEADER]] || '').trim();
}

export function getTransactionReference(
  tds: TransactionsTrTds,
  hdrs: TransactionTableHeaders,
): string {
  return (tds[hdrs[REFERENCE_HEADER]] || '').trim();
}

export function getTransactionDebit(tds: TransactionsTrTds, hdrs: TransactionTableHeaders): string {
  return (tds[hdrs[DEBIT_HEADER]] || '').trim();
}

export function getTransactionCredit(
  tds: TransactionsTrTds,
  hdrs: TransactionTableHeaders,
): string {
  return (tds[hdrs[CREDIT_HEADER]] || '').trim();
}

export function extractTransactionDetails(
  txnRow: TransactionsTr,
  txnsTableHeaders: TransactionTableHeaders,
  txnStatus: TransactionStatuses,
): ScrapedTransaction {
  const tds = txnRow.innerTds;
  return {
    status: txnStatus,
    date: getTransactionDate(tds, txnsTableHeaders),
    description: getTransactionDescription(tds, txnsTableHeaders),
    reference: getTransactionReference(tds, txnsTableHeaders),
    debit: getTransactionDebit(tds, txnsTableHeaders),
    credit: getTransactionCredit(tds, txnsTableHeaders),
    memo: '',
  };
}

export function isExpandedDescRow(txnRow: TransactionsTr): boolean {
  return txnRow.id === 'rowAdded';
}

export function editLastTransactionDesc(
  txnRow: TransactionsTr,
  lastTxn: ScrapedTransaction,
): ScrapedTransaction {
  lastTxn.description = `${lastTxn.description} ${txnRow.innerTds[0]}`;
  return lastTxn;
}

export interface HandleTxnRowOpts {
  txns: ScrapedTransaction[];
  txnsTableHeaders: TransactionTableHeaders;
  txnRow: TransactionsTr;
  txnType: TransactionStatuses;
}

export function handleTransactionRow(opts: HandleTxnRowOpts): void {
  const { txns, txnsTableHeaders, txnRow, txnType } = opts;
  if (isExpandedDescRow(txnRow)) {
    const lastTransaction = txns.pop();
    if (lastTransaction) txns.push(editLastTransactionDesc(txnRow, lastTransaction));
    else throw new Error('internal union-bank error');
  } else {
    txns.push(extractTransactionDetails(txnRow, txnsTableHeaders, txnType));
  }
}
