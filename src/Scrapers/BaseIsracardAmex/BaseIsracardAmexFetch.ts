import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage } from '../../Common/Fetch';
import { sleep } from '../../Common/Waiting';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import {
  type IScrapedAccount,
  type IScrapedAccountsWithinPageResponse,
  type IScrapedTransactionData,
} from './BaseIsracardAmexTypes';

const DATE_FORMAT = 'DD/MM/YYYY';
const RATE_LIMIT_SLEEP_BETWEEN = 1000;
const LOG = getDebug('base-isracard-amex');

/**
 * Builds the DashboardMonth API URL for the given month.
 *
 * @param servicesUrl - the base services URL for the bank's API
 * @param monthMoment - the billing month to fetch account data for
 * @returns the full URL for the DashboardMonth API endpoint
 */
function getAccountsUrl(servicesUrl: string, monthMoment: Moment): string {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}

/**
 * Fetches all card accounts for the given billing month.
 *
 * @param page - the Playwright page used to make the API request
 * @param servicesUrl - the base services URL for the bank's API
 * @param monthMoment - the billing month to fetch account data for
 * @returns an array of scraped account objects for the given month
 */
export async function fetchAccounts(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): Promise<IScrapedAccount[]> {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  LOG.info(`fetching accounts from ${dataUrl}`);
  const dataResult = await fetchGetWithinPage<IScrapedAccountsWithinPageResponse>(page, dataUrl);
  return dataResult.isFound ? parseAccountsFromResponse(dataResult.value) : [];
}

/**
 * Parses the raw API response into an array of scraped account objects.
 *
 * @param parsed - the raw API response from the DashboardMonth endpoint
 * @returns an array of scraped account objects, or an empty array when data is missing
 */
function parseAccountsFromResponse(parsed: IScrapedAccountsWithinPageResponse): IScrapedAccount[] {
  if (_.get(parsed, 'Header.Status') !== '1' || !parsed.DashboardMonthBean) return [];
  const { cardsCharges } = parsed.DashboardMonthBean;
  if (!cardsCharges) return [];
  return cardsCharges.map(cardCharge => ({
    index: parseInt(cardCharge.cardIndex, 10),
    accountNumber: cardCharge.cardNumber,
    processedDate: moment(cardCharge.billingDate, DATE_FORMAT).toISOString(),
  }));
}

/**
 * Builds the CardsTransactionsList API URL for the given month.
 *
 * @param servicesUrl - the base services URL for the bank's API
 * @param monthMoment - the billing month to fetch transactions for
 * @returns the full URL for the CardsTransactionsList API endpoint
 */
function getTransactionsUrl(servicesUrl: string, monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${String(month)}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  const yearStr = String(year);
  url.searchParams.set('year', yearStr);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}

/**
 * Fetches raw transaction data for the given billing month.
 *
 * @param page - the Playwright page used to make the API request
 * @param servicesUrl - the base services URL for the bank's API
 * @param monthMoment - the billing month to fetch transactions for
 * @returns FoundResult wrapping the raw transaction data, or isFound=false if the request failed
 */
export async function fetchTxnData(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): Promise<FoundResult<IScrapedTransactionData>> {
  const dataUrl = getTransactionsUrl(servicesUrl, monthMoment);
  await sleep(RATE_LIMIT_SLEEP_BETWEEN);
  LOG.info(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  return fetchGetWithinPage<IScrapedTransactionData>(page, dataUrl);
}
