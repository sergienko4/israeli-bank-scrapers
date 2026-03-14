import _ from 'lodash';
import { type Moment } from 'moment';
import { type Page } from 'playwright-core';

import getAllMonthMoments from '../../Common/Dates.js';
import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage } from '../../Common/Fetch.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { runSerial } from '../../Common/Waiting.js';
import { type ITransaction } from '../../Transactions.js';
import { fetchAccounts, fetchTxnData } from './BaseIsracardAmexFetch.js';
import { buildAccountTxns, combineTxnsFromResults } from './BaseIsracardAmexTransactions.js';
import {
  type IAdditionalInfoOpts,
  type IExtraScrapAccountOpts,
  type IExtraScrapTxnOpts,
  type IFetchAllOpts,
  type IFetchTransactionsOpts,
  type IScrapedTransactionData,
  type ScrapedAccountsWithIndex,
} from './BaseIsracardAmexTypes.js';
import { TRANSACTIONS_BATCH_SIZE } from './Config/IsracardAmexFetchConfig.js';

const LOG = getDebug('base-isracard-amex');

/**
 * Build the URL for fetching extra transaction detail.
 * @param opts - single-transaction enrichment options
 * @returns fully qualified API URL with query parameters
 */
function buildExtraScrapUrl(opts: IExtraScrapTxnOpts): string {
  const { options, month, accountIndex, transaction } = opts;
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  const cardIndexStr = String(accountIndex);
  url.searchParams.set('CardIndex', cardIndexStr);
  const identifier = transaction.identifier ?? 0;
  const identifierStr = String(identifier);
  url.searchParams.set('shovarRatz', identifierStr);
  const formattedMonth = month.format('MMYYYY');
  url.searchParams.set('moedChiuv', formattedMonth);
  return url.toString();
}

/**
 * Fetch extra per-transaction detail (category, raw data) from the portal API.
 * @param opts - single-transaction enrichment options
 * @returns enriched transaction with category and raw data
 */
export async function getExtraScrapTransaction(opts: IExtraScrapTxnOpts): Promise<ITransaction> {
  const { page, month, transaction } = opts;
  const identifier = transaction.identifier ?? 0;
  const formattedMonth = month.format('YYYY-MM');
  LOG.debug(
    `fetching extra scrap for transaction ${String(identifier)} for month ${formattedMonth}`,
  );
  const apiUrl = buildExtraScrapUrl(opts);
  const data = await fetchGetWithinPage<IScrapedTransactionData>(page, apiUrl);
  if (!data || !Object.keys(data).length) return transaction;
  const rawCategory: string = _.get(data, 'PirteyIska_204Bean.sector') ?? '';
  const rawTransaction = getRawTransaction(data, transaction);
  return { ...transaction, category: rawCategory.trim(), rawTransaction };
}

/**
 * Fetch account list and transaction data for a single billing month.
 * @param opts - month-specific fetch options
 * @returns per-account transaction map for the given month
 */
export async function fetchTransactionsForMonth(
  opts: IFetchTransactionsOpts,
): Promise<ScrapedAccountsWithIndex> {
  const { page, companyServiceOptions, monthMoment } = opts;
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataResult = await fetchTxnData(page, companyServiceOptions.servicesUrl, monthMoment);
  if (!dataResult) return {};
  const headerStatus = _.get(dataResult, 'Header.Status') ?? '';
  if (headerStatus !== '1' || !dataResult.CardsTransactionsListBean) return {};
  return buildAccountTxns({
    accounts,
    dataResult,
    options: opts.options,
    startMoment: opts.startMoment,
  });
}

interface IEnrichTransactionChunkOpts {
  page: Page;
  chunk: ITransaction[];
  account: ScrapedAccountsWithIndex[string];
  opts: Pick<IExtraScrapAccountOpts, 'options' | 'month'>;
}

/**
 * Enrich a batch of transactions with extra scraping data.
 * @param chunkOpts - chunk enrichment options
 * @param chunkOpts.page - Playwright page instance
 * @param chunkOpts.chunk - transactions to enrich
 * @param chunkOpts.account - account metadata with index
 * @param chunkOpts.opts - service config and billing month
 * @returns enriched transactions for the chunk
 */
async function enrichTxnsChunk({
  page,
  chunk,
  account,
  opts,
}: IEnrichTransactionChunkOpts): Promise<ITransaction[]> {
  LOG.debug('processing chunk of %d txns for account %s', chunk.length, account.accountNumber);
  const requests = chunk.map(t =>
    getExtraScrapTransaction({
      page,
      options: opts.options,
      month: opts.month,
      accountIndex: account.index,
      transaction: t,
    }),
  );
  return Promise.all(requests);
}

/**
 * Enrich all transactions for a single account, processing in batches.
 * @param page - Playwright page instance
 * @param account - account with transactions to enrich
 * @param opts - options containing service config and billing month
 * @returns account with enriched transactions
 */
async function enrichAccountTxns(
  page: Page,
  account: ScrapedAccountsWithIndex[string],
  opts: Pick<IExtraScrapAccountOpts, 'options' | 'month'>,
): Promise<ScrapedAccountsWithIndex[string]> {
  const chunks = _.chunk(account.txns, TRANSACTIONS_BATCH_SIZE);
  const enrichTasks = chunks.map(
    txnsChunk => (): Promise<ITransaction[]> =>
      enrichTxnsChunk({ page, chunk: txnsChunk, account, opts }),
  );
  const enrichedChunks = await runSerial(enrichTasks);
  const txns = enrichedChunks.flat();
  return { ...account, txns };
}

type AccountEntry = ScrapedAccountsWithIndex[string];
type AccountTask = () => Promise<AccountEntry>;

/**
 * Build enrichment tasks for all accounts, logging each.
 * @param opts - account-level enrichment options
 * @param formattedMonth - display-formatted billing month
 * @returns array of serial-runnable enrichment tasks
 */
function buildAccountEnrichTasks(
  opts: IExtraScrapAccountOpts,
  formattedMonth: string,
): AccountTask[] {
  const { page, options, accountMap, month } = opts;
  return Object.values(accountMap).map((account): AccountTask => {
    const txnCount = String(account.txns.length);
    const acctNum = account.accountNumber;
    LOG.debug(
      `get extra scrap for ${acctNum} with ${txnCount} transactions, month ${formattedMonth}`,
    );
    return (): Promise<AccountEntry> => enrichAccountTxns(page, account, { options, month });
  });
}

/**
 * Enrich all accounts in the map with extra transaction details for a billing month.
 * @param opts - account-level enrichment options
 * @returns enriched per-account transaction map
 */
export async function getExtraScrapAccount(
  opts: IExtraScrapAccountOpts,
): Promise<ScrapedAccountsWithIndex> {
  const formattedMonth = opts.month.format('YYYY-MM');
  const accountTasks = buildAccountEnrichTasks(opts, formattedMonth);
  const enrichedAccounts = await runSerial(accountTasks);
  return enrichedAccounts.reduce(
    (m: ScrapedAccountsWithIndex, x) => ({ ...m, [x.accountNumber]: x }),
    {},
  );
}

/**
 * Conditionally enrich transactions with additional detail from the portal API.
 * @param opts - additional info enrichment options
 * @returns enriched or original account data depending on scraper options
 */
export async function getAdditionalTransactionInformation(
  opts: IAdditionalInfoOpts,
): Promise<ScrapedAccountsWithIndex[]> {
  const { scraperOptions, accountsWithIndex, page, options, allMonths } = opts;
  const shouldSkip =
    !scraperOptions.shouldAddTransactionInformation ||
    scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation');
  if (shouldSkip) return accountsWithIndex;
  const enrichTasks = accountsWithIndex.map(
    (a, i): (() => Promise<ScrapedAccountsWithIndex>) =>
      (): Promise<ScrapedAccountsWithIndex> =>
        getExtraScrapAccount({ page, options, accountMap: a, month: allMonths[i] }),
  );
  return runSerial(enrichTasks);
}

/**
 * Fetch monthly transaction results sequentially across all billing months.
 * @param opts - fetch-all options with page and service config
 * @param allMonths - array of billing month moments to scrape
 * @returns per-month account transaction maps
 */
function fetchMonthlyResults(
  opts: IFetchAllOpts,
  allMonths: Moment[],
): Promise<ScrapedAccountsWithIndex[]> {
  const { page, options, companyServiceOptions, startMoment } = opts;
  const monthTasks = allMonths.map(
    (monthMoment): (() => Promise<ScrapedAccountsWithIndex>) =>
      (): Promise<ScrapedAccountsWithIndex> =>
        fetchTransactionsForMonth({
          page,
          options,
          companyServiceOptions,
          startMoment,
          monthMoment,
        }),
  );
  return runSerial(monthTasks);
}

/**
 * Enrich monthly results with extra info and combine into per-account transaction lists.
 * @param opts - fetch-all options
 * @param results - raw monthly scraping results
 * @param allMonths - billing months corresponding to results
 * @returns combined per-account transaction map
 */
async function enrichAndCombine(
  opts: IFetchAllOpts,
  results: ScrapedAccountsWithIndex[],
  allMonths: Moment[],
): Promise<Record<string, ITransaction[]>> {
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

/**
 * Orchestrate full transaction fetch: monthly scraping, enrichment, and aggregation.
 * @param opts - top-level fetch options
 * @returns success flag and per-account transaction arrays
 */
export async function fetchAllTransactions(
  opts: IFetchAllOpts,
): Promise<{ success: boolean; accounts: { accountNumber: string; txns: ITransaction[] }[] }> {
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
