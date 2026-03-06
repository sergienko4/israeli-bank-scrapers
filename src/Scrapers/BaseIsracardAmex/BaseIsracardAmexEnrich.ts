import _ from 'lodash';
import { type Moment } from 'moment';
import { type Page } from 'playwright';

import getAllMonthMoments from '../../Common/Dates';
import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { runSerial, sleep } from '../../Common/Waiting';
import { type Transaction } from '../../Transactions';
import { fetchAccounts, fetchTxnData } from './BaseIsracardAmexFetch';
import { buildAccountTxns, combineTxnsFromResults } from './BaseIsracardAmexTransactions';
import {
  type AdditionalInfoOpts,
  type ExtraScrapAccountOpts,
  type ExtraScrapTxnOpts,
  type FetchAllOpts,
  type FetchTransactionsOpts,
  type ScrapedAccountsWithIndex,
  type ScrapedTransactionData,
} from './BaseIsracardAmexTypes';

const RATE_LIMIT = { SLEEP_BETWEEN: 1000, TRANSACTIONS_BATCH_SIZE: 10 } as const;
const LOG = getDebug('base-isracard-amex');

/**
 * Fetches and processes all transactions for a single billing month.
 *
 * @param opts - fetch options with page, company service options, scraper options, and month
 * @returns a map of account numbers to their transactions for the month
 */
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

/**
 * Fetches additional details (category, raw data) for a single transaction via PirteyIska_204.
 *
 * @param opts - options with page, service options, month, account index, and the base transaction
 * @returns the transaction enriched with category and rawTransaction fields
 */
interface ExtraScrapUrlOpts {
  servicesUrl: string;
  accountIndex: number;
  txnId: number;
  monthStr: string;
}

/**
 * Builds the PirteyIska_204 API URL for extra transaction details.
 * @param opts - URL construction options
 * @param opts.servicesUrl - base services URL
 * @param opts.accountIndex - card account index
 * @param opts.txnId - transaction identifier
 * @param opts.monthStr - billing month in MMYYYY format
 * @returns the full API URL string
 */
function buildExtraScrapUrl(opts: ExtraScrapUrlOpts): string {
  const { servicesUrl, accountIndex, txnId, monthStr } = opts;
  const url = new URL(servicesUrl);
  const cardIndexStr = accountIndex.toString();
  const txnIdStr = txnId.toString();
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', cardIndexStr);
  url.searchParams.set('shovarRatz', txnIdStr);
  url.searchParams.set('moedChiuv', monthStr);
  return url.toString();
}

/**
 * Fetches additional details (category, raw data) for a single transaction via PirteyIska_204.
 * @param opts - options with page, service options, month, account index, and the base transaction
 * @returns the transaction enriched with category and rawTransaction fields
 */
export async function getExtraScrapTransaction(opts: ExtraScrapTxnOpts): Promise<Transaction> {
  const { page, options, month, accountIndex, transaction } = opts;
  const txnId = Number(transaction.identifier ?? 0);
  const apiUrl = buildExtraScrapUrl({
    servicesUrl: options.servicesUrl,
    accountIndex,
    txnId,
    monthStr: month.format('MMYYYY'),
  });
  const txnLabel = String(transaction.identifier ?? '');
  LOG.info(`fetching extra scrap for transaction ${txnLabel} for month ${month.format('YYYY-MM')}`);
  const data = await fetchGetWithinPage<ScrapedTransactionData>(page, apiUrl);
  if (!data) return transaction;
  const rawCategory = _.get(data, 'PirteyIska_204Bean.sector') ?? '';
  const enrichedTxn = { ...transaction, category: rawCategory.trim() };
  return { ...enrichedTxn, rawTransaction: getRawTransaction(data, transaction) };
}

interface EnrichChunkOpts {
  page: Page;
  chunk: Transaction[];
  account: ScrapedAccountsWithIndex[string];
  opts: Pick<ExtraScrapAccountOpts, 'options' | 'month'>;
}

/**
 * Enriches a batch of transactions concurrently, then sleeps to avoid rate-limiting.
 *
 * @param enrichChunkOpts - batch enrichment options
 * @param enrichChunkOpts.page - the Playwright page for API requests
 * @param enrichChunkOpts.chunk - the batch of transactions to enrich
 * @param enrichChunkOpts.account - the account the transactions belong to
 * @param enrichChunkOpts.opts - service options and billing month
 * @returns the enriched transactions for this batch
 */
async function enrichTxnsChunk({
  page,
  chunk,
  account,
  opts,
}: EnrichChunkOpts): Promise<Transaction[]> {
  LOG.info('processing chunk of %d txns for account %s', chunk.length, account.accountNumber);
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

/**
 * Enriches all transactions for one account by processing them in rate-limited batches.
 *
 * @param page - the Playwright page for API requests
 * @param account - the account whose transactions to enrich
 * @param opts - service options and billing month
 * @returns the account with all transactions enriched
 */
async function enrichAccountTxns(
  page: Page,
  account: ScrapedAccountsWithIndex[string],
  opts: Pick<ExtraScrapAccountOpts, 'options' | 'month'>,
): Promise<ScrapedAccountsWithIndex[string]> {
  const emptyTxns = Promise.resolve([] as Transaction[]);
  const txns = await _.chunk(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE).reduce(
    async (prevPromise, txnsChunk) => {
      const acc = await prevPromise;
      const enriched = await enrichTxnsChunk({ page, chunk: txnsChunk, account, opts });
      return [...acc, ...enriched];
    },
    emptyTxns,
  );
  return { ...account, txns };
}

/**
 * Enriches all accounts in the accountMap with additional transaction details.
 *
 * @param opts - options with page, service options, account map, and billing month
 * @returns the enriched accounts map
 */
export async function getExtraScrapAccount(
  opts: ExtraScrapAccountOpts,
): Promise<ScrapedAccountsWithIndex> {
  const { page, options, accountMap, month } = opts;
  const emptyAccountList = Promise.resolve<ScrapedAccountsWithIndex[string][]>([]);
  const accounts = await Object.values(accountMap).reduce(async (prevPromise, account) => {
    const acc = await prevPromise;
    LOG.info(
      `get extra scrap for ${account.accountNumber} with ${String(account.txns.length)} transactions, month ${month.format('YYYY-MM')}`,
    );
    acc.push(await enrichAccountTxns(page, account, { options, month }));
    return acc;
  }, emptyAccountList);
  return accounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});
}

/**
 * Optionally enriches all monthly transaction results with additional API data (category, raw).
 *
 * @param opts - options including scraper options, accounts-with-index results, page, and all months
 * @returns the account results (enriched if shouldAddTransactionInformation is set)
 */
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
  const enrichTasks = accountsWithIndex.map(
    (a, i): (() => Promise<ScrapedAccountsWithIndex>) =>
      () =>
        getExtraScrapAccount({ page, options, accountMap: a, month: allMonths[i] }),
  );
  return runSerial(enrichTasks);
}

/**
 * Serially fetches transaction data for each billing month.
 *
 * @param opts - fetch options with page, company service options, scraper options, and start date
 * @param allMonths - the list of billing months to fetch data for
 * @returns an array of per-month account transaction maps
 */
function fetchMonthlyResults(
  opts: FetchAllOpts,
  allMonths: Moment[],
): Promise<ScrapedAccountsWithIndex[]> {
  const { page, options, companyServiceOptions, startMoment } = opts;
  const monthlyTasks = allMonths.map(
    (monthMoment): (() => Promise<ScrapedAccountsWithIndex>) =>
      () =>
        fetchTransactionsForMonth({
          page,
          options,
          companyServiceOptions,
          startMoment,
          monthMoment,
        }),
  );
  return runSerial(monthlyTasks);
}

/**
 * Enriches the monthly results and combines them into a single account-to-transactions map.
 *
 * @param opts - fetch options with page, company service options, and scraper options
 * @param results - the per-month account transaction maps to enrich and combine
 * @param allMonths - the billing months corresponding to each result entry
 * @returns a merged map of account numbers to all their enriched transactions
 */
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

/**
 * Orchestrates the full transaction fetch: all months → enrich → combine → return.
 *
 * @param opts - options including page, company service options, scraper options, and start date
 * @returns a successful scraping result with all account transactions across all months
 */
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
