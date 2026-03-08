import _ from 'lodash';
import { type Moment } from 'moment';
import { type Page } from 'playwright';

import getAllMonthMoments from '../../Common/Dates.js';
import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage } from '../../Common/Fetch.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { runSerial, sleep } from '../../Common/Waiting.js';
import { type Transaction } from '../../Transactions.js';
import { fetchAccounts, fetchTxnData } from './BaseIsracardAmexFetch.js';
import { buildAccountTxns, combineTxnsFromResults } from './BaseIsracardAmexTransactions.js';
import {
  type AdditionalInfoOpts,
  type ExtraScrapAccountOpts,
  type ExtraScrapTxnOpts,
  type FetchAllOpts,
  type FetchTransactionsOpts,
  type ScrapedAccountsWithIndex,
  type ScrapedTransactionData,
} from './BaseIsracardAmexTypes.js';

const RATE_LIMIT = { SLEEP_BETWEEN: 1000, TRANSACTIONS_BATCH_SIZE: 10 } as const;
const LOG = getDebug('base-isracard-amex');

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
  LOG.info(
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
    LOG.info(
      `get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions, month ${month.format('YYYY-MM')}`,
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
