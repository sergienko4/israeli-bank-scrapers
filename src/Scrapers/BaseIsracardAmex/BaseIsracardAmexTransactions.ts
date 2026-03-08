import moment from 'moment';

import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
} from '../../Common/Transactions.js';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../../Constants.js';
import {
  type Transaction,
  type TransactionInstallments,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import {
  type BuildTxnsOpts,
  type CollectTxnsOpts,
  type ScrapedAccountsWithIndex,
  type ScrapedTransaction,
} from './BaseIsracardAmexTypes.js';

export { fetchAccounts } from './BaseIsracardAmexFetch.js';

const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';

export function convertCurrency(currencyStr: string): string {
  return currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY
    ? SHEKEL_CURRENCY
    : currencyStr;
}

export function getInstallmentsInfo(txn: ScrapedTransaction): TransactionInstallments | undefined {
  if (!txn.moreInfo?.includes(INSTALLMENTS_KEYWORD)) return undefined;
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) return undefined;
  return { number: parseInt(matches[0], 10), total: parseInt(matches[1], 10) };
}

function getTransactionType(txn: ScrapedTransaction): TransactionTypes {
  return getInstallmentsInfo(txn) ? TransactionTypes.Installments : TransactionTypes.Normal;
}

function buildTxnAmounts(
  txn: ScrapedTransaction,
): Pick<Transaction, 'originalAmount' | 'originalCurrency' | 'chargedAmount' | 'chargedCurrency'> {
  const isOutbound = txn.dealSumOutbound;
  return {
    originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
    originalCurrency: convertCurrency(txn.currentPaymentCurrency),
    chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
    chargedCurrency: convertCurrency(txn.currencyId),
  };
}

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

export function buildTransaction(
  txn: ScrapedTransaction,
  processedDate: string,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = buildTransactionBase(txn, processedDate);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

export function filterValidTransactions(txns: ScrapedTransaction[]): ScrapedTransaction[] {
  return txns.filter(
    txn =>
      txn.dealSumType !== '1' &&
      txn.voucherNumberRatz !== '000000000' &&
      txn.voucherNumberRatzOutbound !== '000000000',
  );
}

export function convertTransactions(
  txns: ScrapedTransaction[],
  processedDate: string,
  options?: ScraperOptions,
): Transaction[] {
  return filterValidTransactions(txns).map(txn => buildTransaction(txn, processedDate, options));
}

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

export function buildAccountTxns(bOpts: BuildTxnsOpts): ScrapedAccountsWithIndex {
  const { accounts, dataResult, options, startMoment } = bOpts;
  const accountTxns: ScrapedAccountsWithIndex = {};
  accounts.forEach(account => {
    const txnGroups =
      dataResult.CardsTransactionsListBean?.[`Index${account.index}`]?.CurrentCardTransactions;
    if (!txnGroups) return;
    accountTxns[account.accountNumber] = {
      accountNumber: account.accountNumber,
      index: account.index,
      txns: collectAccountTxns({ txnGroups, account, options, startMoment }),
    };
  });
  return accountTxns;
}

export function combineTxnsFromResults(
  finalResult: ScrapedAccountsWithIndex[],
): Record<string, Transaction[]> {
  const combinedTxns: Record<string, Transaction[]> = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard for API responses
      if (!combinedTxns[accountNumber]) combinedTxns[accountNumber] = [];
      combinedTxns[accountNumber].push(...result[accountNumber].txns);
    });
  });
  return combinedTxns;
}
