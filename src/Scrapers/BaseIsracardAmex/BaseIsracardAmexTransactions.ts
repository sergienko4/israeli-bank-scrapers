import moment from 'moment';

import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
} from '../../Common/Transactions.js';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../../Constants.js';
import {
  type ITransaction,
  type ITransactionInstallments,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import {
  type IBuildTxnsOpts,
  type ICollectTxnsOpts,
  type IScrapedTransaction,
  type ScrapedAccountsWithIndex,
} from './BaseIsracardAmexTypes.js';

export { fetchAccounts } from './BaseIsracardAmexFetch.js';
import { ISRACARD_DATE_FORMAT } from './Config/IsracardAmexFetchConfig.js';

const INSTALLMENTS_KEYWORD = 'תשלום';

type TxnAmounts = Pick<
  ITransaction,
  'originalAmount' | 'originalCurrency' | 'chargedAmount' | 'chargedCurrency'
>;

/**
 * Convert portal currency strings to the standard shekel symbol or pass through.
 * @param currencyStr - raw currency string from the portal
 * @returns normalized currency code
 */
export function convertCurrency(currencyStr: string): string {
  return currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY
    ? SHEKEL_CURRENCY
    : currencyStr;
}

/**
 * Extract installment info (number/total) from the transaction moreInfo field.
 * @param txn - scraped transaction with possible installment data
 * @returns parsed installment info or false when not an installment
 */
export function getInstallmentsInfo(txn: IScrapedTransaction): ITransactionInstallments | false {
  if (!txn.moreInfo?.includes(INSTALLMENTS_KEYWORD)) return false;
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) return false;
  return { number: Number.parseInt(matches[0], 10), total: Number.parseInt(matches[1], 10) };
}

/**
 * Determine whether a transaction is Normal or Installments.
 * @param txn - scraped transaction to classify
 * @returns transaction type enum value
 */
function getTransactionType(txn: IScrapedTransaction): TransactionTypes {
  return getInstallmentsInfo(txn) ? TransactionTypes.Installments : TransactionTypes.Normal;
}

/**
 * Compute original and charged amounts with currency conversion.
 * @param txn - scraped transaction with amount fields
 * @returns amount and currency fields for the standard transaction
 */
function buildTxnAmounts(txn: IScrapedTransaction): TxnAmounts {
  const isOutbound = txn.dealSumOutbound;
  return {
    originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
    originalCurrency: convertCurrency(txn.currentPaymentCurrency),
    chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
    chargedCurrency: convertCurrency(txn.currencyId),
  };
}

/**
 * Resolve the transaction date and processed date strings.
 * @param txn - scraped transaction
 * @param processedDate - fallback processed date ISO string
 * @returns date and processedDate ISO strings
 */
function resolveTxnDates(
  txn: IScrapedTransaction,
  processedDate: string,
): { date: string; processedDate: string } {
  const isOutbound = txn.dealSumOutbound;
  const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
  const resolvedProcessedDate = txn.fullPaymentDate
    ? moment(txn.fullPaymentDate, ISRACARD_DATE_FORMAT).toISOString()
    : processedDate;
  const date = moment(txnDateStr, ISRACARD_DATE_FORMAT).toISOString();
  return { date, processedDate: resolvedProcessedDate };
}

/**
 * Build the base transaction object (without rawTransaction) from scraped data.
 * @param txn - scraped transaction to convert
 * @param processedDate - fallback processed date ISO string
 * @returns standard transaction object without rawTransaction
 */
export function buildTransactionBase(
  txn: IScrapedTransaction,
  processedDate: string,
): Omit<ITransaction, 'rawTransaction'> {
  const isOutbound = txn.dealSumOutbound;
  const installments = getInstallmentsInfo(txn);
  const voucherNum = isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz;
  const dates = resolveTxnDates(txn, processedDate);
  return {
    type: getTransactionType(txn),
    identifier: Number.parseInt(voucherNum, 10),
    ...dates,
    ...buildTxnAmounts(txn),
    description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
    memo: txn.moreInfo ?? '',
    ...(installments ? { installments } : {}),
    status: TransactionStatuses.Completed,
  };
}

/**
 * Build a complete transaction, optionally including raw data.
 * @param txn - scraped transaction to convert
 * @param processedDate - fallback processed date ISO string
 * @param options - scraper options controlling raw data inclusion
 * @returns fully built standard transaction
 */
export function buildTransaction(
  txn: IScrapedTransaction,
  processedDate: string,
  options?: ScraperOptions,
): ITransaction {
  const result: ITransaction = buildTransactionBase(txn, processedDate);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Filter out voided and zero-voucher transactions.
 * @param txns - scraped transactions to filter
 * @returns valid transactions only
 */
export function filterValidTransactions(txns: IScrapedTransaction[]): IScrapedTransaction[] {
  return txns.filter(
    txn =>
      txn.dealSumType !== '1' &&
      txn.voucherNumberRatz !== '000000000' &&
      txn.voucherNumberRatzOutbound !== '000000000',
  );
}

/**
 * Convert scraped transactions to the standard ITransaction format.
 * @param txns - scraped transactions to convert
 * @param processedDate - fallback processed date ISO string
 * @param options - scraper options
 * @returns array of standard transactions
 */
export function convertTransactions(
  txns: IScrapedTransaction[],
  processedDate: string,
  options?: ScraperOptions,
): ITransaction[] {
  return filterValidTransactions(txns).map(txn => buildTransaction(txn, processedDate, options));
}

/**
 * Flatten Israel and abroad transaction groups into a single array.
 * @param txnGroups - grouped scraped transactions
 * @param processedDate - fallback processed date
 * @param options - scraper options
 * @returns flat array of converted transactions
 */
function flattenTxnGroups(
  txnGroups: ICollectTxnsOpts['txnGroups'],
  processedDate: string,
  options: ScraperOptions,
): ITransaction[] {
  const allTxns: ITransaction[] = [];
  txnGroups.forEach(txnGroup => {
    if (txnGroup.txnIsrael)
      allTxns.push(...convertTransactions(txnGroup.txnIsrael, processedDate, options));
    if (txnGroup.txnAbroad)
      allTxns.push(...convertTransactions(txnGroup.txnAbroad, processedDate, options));
  });
  return allTxns;
}

/**
 * Collect and post-process all transactions for a single account.
 * @param opts - collection options with transaction groups and filters
 * @returns processed and filtered transactions
 */
export function collectAccountTxns(opts: ICollectTxnsOpts): ITransaction[] {
  const { txnGroups, account, options, startMoment } = opts;
  let allTxns = flattenTxnGroups(txnGroups, account.processedDate, options);
  if (!options.shouldCombineInstallments) allTxns = fixInstallments(allTxns);
  if (options.outputData?.isFilterByDateEnabled ?? true)
    allTxns = filterOldTransactions(
      allTxns,
      startMoment,
      options.shouldCombineInstallments ?? false,
    );
  return allTxns;
}

/**
 * Build per-account transaction maps from the portal response.
 * @param bOpts - build options with accounts, data, and filters
 * @returns per-account transaction map keyed by account number
 */
export function buildAccountTxns(bOpts: IBuildTxnsOpts): ScrapedAccountsWithIndex {
  const { accounts, dataResult, options, startMoment } = bOpts;
  const accountTxns: ScrapedAccountsWithIndex = {};
  accounts.forEach(account => {
    const indexKey = `Index${String(account.index)}`;
    const txnGroups = dataResult.CardsTransactionsListBean?.[indexKey]?.CurrentCardTransactions;
    if (!txnGroups) return;
    accountTxns[account.accountNumber] = {
      accountNumber: account.accountNumber,
      index: account.index,
      txns: collectAccountTxns({ txnGroups, account, options, startMoment }),
    };
  });
  return accountTxns;
}

/**
 * Merge per-month per-account results into a single account-to-transactions map.
 * @param finalResult - array of monthly per-account transaction maps
 * @returns combined account-to-transactions map
 */
export function combineTxnsFromResults(
  finalResult: ScrapedAccountsWithIndex[],
): Record<string, ITransaction[]> {
  const combinedTxns: Record<string, ITransaction[]> = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      combinedTxns[accountNumber] ??= [];
      combinedTxns[accountNumber].push(...result[accountNumber].txns);
    });
  });
  return combinedTxns;
}
