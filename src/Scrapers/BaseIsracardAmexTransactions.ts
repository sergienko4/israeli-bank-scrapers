import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../Constants';
import getAllMonthMoments from '../Helpers/Dates';
import { getDebug } from '../Helpers/Debug';
import { fetchGetWithinPage } from '../Helpers/Fetch';
import { filterOldTransactions, fixInstallments, getRawTransaction } from '../Helpers/Transactions';
import { runSerial, sleep } from '../Helpers/Waiting';
import {
  type Transaction,
  type TransactionInstallments,
  TransactionStatuses,
  TransactionTypes,
} from '../Transactions';
import { fetchAccounts, fetchTxnData } from './BaseIsracardAmexFetch';
import {
  type AdditionalInfoOpts,
  type BuildTxnsOpts,
  type CollectTxnsOpts,
  type ExtraScrapAccountOpts,
  type ExtraScrapTxnOpts,
  type FetchAllOpts,
  type FetchTransactionsOpts,
  type ScrapedAccountsWithIndex,
  type ScrapedTransaction,
  type ScrapedTransactionData,
} from './BaseIsracardAmexTypes';
import { type ScraperOptions } from './Interface';

const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';
const RATE_LIMIT = { SLEEP_BETWEEN: 1000, TRANSACTIONS_BATCH_SIZE: 10 } as const;
const DEBUG = getDebug('base-isracard-amex');

export { fetchAccounts } from './BaseIsracardAmexFetch';

export function convertCurrency(currencyStr: string): string {
  return currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY
    ? SHEKEL_CURRENCY
    : currencyStr;
}

export function getInstallmentsInfo(txn: ScrapedTransaction): TransactionInstallments | undefined {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) return undefined;
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
    originalCurrency: convertCurrency(txn.currentPaymentCurrency ?? txn.currencyId),
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
    memo: txn.moreInfo || '',
    installments: getInstallmentsInfo(txn) || undefined,
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
      options.shouldCombineInstallments || false,
    );
  return allTxns;
}

export function buildAccountTxns(bOpts: BuildTxnsOpts): ScrapedAccountsWithIndex {
  const { accounts, dataResult, options, startMoment } = bOpts;
  const accountTxns: ScrapedAccountsWithIndex = {};
  accounts.forEach(account => {
    const txnGroups = (dataResult.CardsTransactionsListBean ?? {})[`Index${account.index}`]
      ?.CurrentCardTransactions;
    if (txnGroups)
      accountTxns[account.accountNumber] = {
        accountNumber: account.accountNumber,
        index: account.index,
        txns: collectAccountTxns({ txnGroups, account, options, startMoment }),
      };
  });
  return accountTxns;
}

export async function fetchTransactionsForMonth(
  opts: FetchTransactionsOpts,
): Promise<ScrapedAccountsWithIndex> {
  const { page, companyServiceOptions, monthMoment } = opts;
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataResult = await fetchTxnData(page, companyServiceOptions.servicesUrl, monthMoment);
  if (
    !dataResult ||
    _.get(dataResult, 'Header.Status') !== '1' ||
    !dataResult.CardsTransactionsListBean
  )
    return {};
  return buildAccountTxns({
    accounts,
    dataResult,
    options: opts.options,
    startMoment: opts.startMoment,
  });
}

export async function getExtraScrapTransaction(opts: ExtraScrapTxnOpts): Promise<Transaction> {
  const { page, options, month, accountIndex, transaction } = opts;
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier!.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));
  DEBUG(
    `fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`,
  );
  const data = await fetchGetWithinPage<ScrapedTransactionData>(page, url.toString());
  if (!data) return transaction;
  const rawCategory = _.get(data, 'PirteyIska_204Bean.sector') ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
    rawTransaction: getRawTransaction(data, transaction),
  };
}

interface EnrichChunkOpts {
  page: Page;
  chunk: Transaction[];
  account: ScrapedAccountsWithIndex[string];
  opts: Pick<ExtraScrapAccountOpts, 'options' | 'month'>;
}

async function enrichTxnsChunk({
  page,
  chunk,
  account,
  opts,
}: EnrichChunkOpts): Promise<Transaction[]> {
  DEBUG(`processing chunk of ${chunk.length} transactions for account ${account.accountNumber}`);
  const requests = chunk.map(t =>
    getExtraScrapTransaction({
      page,
      options: opts.options,
      month: opts.month,
      accountIndex: account.index,
      transaction: t,
    }),
  );
  const updated = await Promise.all(requests);
  await sleep(RATE_LIMIT.SLEEP_BETWEEN);
  return updated;
}

async function enrichAccountTxns(
  page: Page,
  account: ScrapedAccountsWithIndex[string],
  opts: Pick<ExtraScrapAccountOpts, 'options' | 'month'>,
): Promise<ScrapedAccountsWithIndex[string]> {
  const txns: Transaction[] = [];
  for (const txnsChunk of _.chunk(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
    txns.push(...(await enrichTxnsChunk({ page, chunk: txnsChunk, account, opts })));
  }
  return { ...account, txns };
}

export async function getExtraScrapAccount(
  opts: ExtraScrapAccountOpts,
): Promise<ScrapedAccountsWithIndex> {
  const { page, options, accountMap, month } = opts;
  const accounts: ScrapedAccountsWithIndex[string][] = [];
  for (const account of Object.values(accountMap)) {
    DEBUG(
      `get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`,
      month.format('YYYY-MM'),
    );
    accounts.push(await enrichAccountTxns(page, account, { options, month }));
  }
  return accounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});
}

export async function getAdditionalTransactionInformation(
  opts: AdditionalInfoOpts,
): Promise<ScrapedAccountsWithIndex[]> {
  const { scraperOptions, accountsWithIndex, page, options, allMonths } = opts;
  if (
    !scraperOptions.shouldAddTransactionInformation ||
    scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')
  ) {
    return accountsWithIndex;
  }
  return runSerial(
    accountsWithIndex.map(
      (a, i) => () => getExtraScrapAccount({ page, options, accountMap: a, month: allMonths[i] }),
    ),
  );
}

export function combineTxnsFromResults(
  finalResult: ScrapedAccountsWithIndex[],
): Record<string, Transaction[]> {
  const combinedTxns: Record<string, Transaction[]> = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      if (!combinedTxns[accountNumber]) combinedTxns[accountNumber] = [];
      combinedTxns[accountNumber].push(...result[accountNumber].txns);
    });
  });
  return combinedTxns;
}

function fetchMonthlyResults(
  opts: FetchAllOpts,
  allMonths: Moment[],
): Promise<ScrapedAccountsWithIndex[]> {
  const { page, options, companyServiceOptions, startMoment } = opts;
  return runSerial(
    allMonths.map(
      monthMoment => () =>
        fetchTransactionsForMonth({
          page,
          options,
          companyServiceOptions,
          startMoment,
          monthMoment,
        }),
    ),
  );
}

async function enrichAndCombine(
  opts: FetchAllOpts,
  results: ScrapedAccountsWithIndex[],
  allMonths: Moment[],
): Promise<Record<string, Transaction[]>> {
  const { page, options, companyServiceOptions } = opts;
  const finalResult = await getAdditionalTransactionInformation({
    scraperOptions: options,
    accountsWithIndex: results,
    page,
    options: companyServiceOptions,
    allMonths,
  });
  return combineTxnsFromResults(finalResult);
}

export async function fetchAllTransactions(
  opts: FetchAllOpts,
): Promise<{ success: boolean; accounts: { accountNumber: string; txns: Transaction[] }[] }> {
  const { options } = opts;
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = getAllMonthMoments(opts.startMoment, futureMonthsToScrape);
  const results = await fetchMonthlyResults(opts, allMonths);
  const combinedTxns = await enrichAndCombine(opts, results, allMonths);
  const accounts = Object.keys(combinedTxns).map(n => ({
    accountNumber: n,
    txns: combinedTxns[n],
  }));
  return { success: true, accounts };
}
