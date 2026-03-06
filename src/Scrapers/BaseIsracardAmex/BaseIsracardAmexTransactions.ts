import moment from 'moment';

import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
} from '../../Common/Transactions';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../../Constants';
import {
  type Transaction,
  type TransactionInstallments,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { type ScraperOptions } from '../Base/Interface';
import {
  type BuildTxnsOpts,
  type CollectTxnsOpts,
  type ScrapedAccountsWithIndex,
  type ScrapedTransaction,
} from './BaseIsracardAmexTypes';

export { fetchAccounts } from './BaseIsracardAmexFetch';

const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';

/**
 * Converts a Hebrew currency string to the standard currency code.
 *
 * @param currencyStr - the raw currency string from the API (e.g. 'ש"ח')
 * @returns the ISO currency code (e.g. 'ILS') or the original string if not recognized
 */
export function convertCurrency(currencyStr: string): string {
  return currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY
    ? SHEKEL_CURRENCY
    : currencyStr;
}

/**
 * Parses installment plan information from the transaction's moreInfo field.
 *
 * @param txn - the raw scraped transaction
 * @returns installment info (number and total) if the transaction is an installment plan, or undefined
 */
export function getInstallmentsInfo(txn: ScrapedTransaction): TransactionInstallments | undefined {
  if (!txn.moreInfo?.includes(INSTALLMENTS_KEYWORD)) return undefined;
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) return undefined;
  return { number: parseInt(matches[0], 10), total: parseInt(matches[1], 10) };
}

/**
 * Determines whether a transaction is Normal or an Installments type.
 *
 * @param txn - the raw scraped transaction
 * @returns the transaction type based on installment info presence
 */
function getTransactionType(txn: ScrapedTransaction): TransactionTypes {
  return getInstallmentsInfo(txn) ? TransactionTypes.Installments : TransactionTypes.Normal;
}

/**
 * Extracts and converts the amount fields from a scraped transaction.
 *
 * @param txn - the raw scraped transaction with deal and payment sum fields
 * @returns the original and charged amount/currency fields
 */
function buildTxnAmounts(
  txn: ScrapedTransaction,
): Pick<Transaction, 'originalAmount' | 'originalCurrency' | 'chargedAmount' | 'chargedCurrency'> {
  const isOutbound = txn.dealSumOutbound;
  return {
    originalAmount: isOutbound ? -Number(txn.dealSumOutbound) : -txn.dealSum,
    originalCurrency: convertCurrency(txn.currentPaymentCurrency),
    chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
    chargedCurrency: convertCurrency(txn.currencyId),
  };
}

/**
 * Builds the core Transaction fields from a scraped transaction (without rawTransaction).
 *
 * @param txn - the raw scraped transaction data
 * @param processedDate - the billing date for this account as an ISO string
 * @returns a Transaction object without the rawTransaction field
 */
export function buildTransactionBase(
  txn: ScrapedTransaction,
  processedDate: string,
): Omit<Transaction, 'rawTransaction'> {
  const isOutbound = txn.dealSumOutbound;
  const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
  return {
    type: getTransactionType(txn),
    identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
    date: moment(txnDateStr, DATE_FORMAT).toISOString(),
    processedDate: txn.fullPaymentDate
      ? moment(txn.fullPaymentDate, DATE_FORMAT).toISOString()
      : processedDate,
    ...buildTxnAmounts(txn),
    description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
    memo: txn.moreInfo ?? '',
    installments: getInstallmentsInfo(txn) ?? undefined,
    status: TransactionStatuses.Completed,
  };
}

/**
 * Builds a complete Transaction, optionally including the rawTransaction field.
 *
 * @param txn - the raw scraped transaction data
 * @param processedDate - the billing date for this account as an ISO string
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a complete Transaction object
 */
export function buildTransaction(
  txn: ScrapedTransaction,
  processedDate: string,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = buildTransactionBase(txn, processedDate);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Filters out invalid or placeholder transactions from the scraped list.
 *
 * @param txns - the full list of scraped transactions
 * @returns only the transactions with valid deal amounts and voucher numbers
 */
export function filterValidTransactions(txns: ScrapedTransaction[]): ScrapedTransaction[] {
  return txns.filter(
    txn =>
      txn.dealSumType !== '1' &&
      txn.voucherNumberRatz !== '000000000' &&
      txn.voucherNumberRatzOutbound !== '000000000',
  );
}

/**
 * Filters and converts an array of scraped transactions to normalized Transaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param processedDate - the billing date for this account as an ISO string
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized Transaction objects
 */
export function convertTransactions(
  txns: ScrapedTransaction[],
  processedDate: string,
  options?: ScraperOptions,
): Transaction[] {
  return filterValidTransactions(txns).map(txn => buildTransaction(txn, processedDate, options));
}

/**
 * Collects and converts all transaction groups for one account into normalized Transaction objects.
 *
 * @param opts - options including transaction groups, account info, scraper options, and start date
 * @returns a filtered and normalized list of transactions for the account
 */
export function collectAccountTxns(opts: CollectTxnsOpts): Transaction[] {
  const { txnGroups, account, options, startMoment } = opts;
  let allTxns: Transaction[] = [];
  txnGroups.forEach(txnGroup => {
    if (txnGroup.txnIsrael)
      allTxns.push(...convertTransactions(txnGroup.txnIsrael, account.processedDate, options));
    if (txnGroup.txnAbroad)
      allTxns.push(...convertTransactions(txnGroup.txnAbroad, account.processedDate, options));
  });
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
 * Builds a map of account numbers to their collected transactions from a monthly data result.
 *
 * @param bOpts - options with accounts, data result, scraper options, and start date
 * @returns a map of account numbers to their ScrapedAccountsWithIndex data
 */
export function buildAccountTxns(bOpts: BuildTxnsOpts): ScrapedAccountsWithIndex {
  const { accounts, dataResult, options, startMoment } = bOpts;
  const accountTxns: ScrapedAccountsWithIndex = {};
  accounts.forEach(account => {
    const txnGroups =
      dataResult.CardsTransactionsListBean?.[`Index${String(account.index)}`]
        ?.CurrentCardTransactions;
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
 * Merges per-month account transaction maps into a single account-to-transactions map.
 *
 * @param finalResult - an array of per-month ScrapedAccountsWithIndex maps
 * @returns a merged map of account numbers to all their transactions across all months
 */
export function combineTxnsFromResults(
  finalResult: ScrapedAccountsWithIndex[],
): Record<string, Transaction[]> {
  const combinedTxns: Record<string, Transaction[]> = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      combinedTxns[accountNumber] ??= [];
      combinedTxns[accountNumber].push(...result[accountNumber].txns);
    });
  });
  return combinedTxns;
}
