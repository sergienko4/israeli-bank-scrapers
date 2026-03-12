import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage } from '../../Common/Fetch.js';
import {
  type IScrapedAccount,
  type IScrapedAccountsWithinPageResponse,
  type IScrapedTransactionData,
} from './BaseIsracardAmexTypes.js';
import { ISRACARD_DATE_FORMAT, RATE_LIMIT_SLEEP_MS } from './Config/IsracardAmexFetchConfig.js';

const LOG = getDebug('base-isracard-amex');

/**
 * Build the API URL for fetching account data for a given billing month.
 * @param servicesUrl - The base services endpoint URL.
 * @param monthMoment - The billing month to query.
 * @returns The fully-qualified data URL with query parameters.
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
 * Fetch the list of card accounts for a specific billing month.
 * @param page - The Playwright page with an active session.
 * @param servicesUrl - The base API services URL.
 * @param monthMoment - The billing month to query.
 * @returns Array of scraped account records, empty if unavailable.
 */
export async function fetchAccounts(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): Promise<IScrapedAccount[]> {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  LOG.debug(`fetching accounts from ${dataUrl}`);
  const dataResult = await fetchGetWithinPage<IScrapedAccountsWithinPageResponse>(page, dataUrl);
  if (!dataResult) return [];
  if (dataResult.Header.Status === '1' && dataResult.DashboardMonthBean) {
    const { cardsCharges } = dataResult.DashboardMonthBean;
    if (!cardsCharges) return [];
    return cardsCharges.map(cardCharge => ({
      index: parseInt(cardCharge.cardIndex, 10),
      accountNumber: cardCharge.cardNumber,
      processedDate: moment(cardCharge.billingDate, ISRACARD_DATE_FORMAT).toISOString(),
    }));
  }
  return [];
}

/**
 * Build the API URL for fetching transactions for a given month.
 * @param servicesUrl - The base services endpoint URL.
 * @param monthMoment - The billing month to query.
 * @returns The fully-qualified transactions URL with query parameters.
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
 * Fetch transaction data for a specific billing month, with rate-limit delay.
 * @param page - The Playwright page with an active session.
 * @param servicesUrl - The base API services URL.
 * @param monthMoment - The billing month to query.
 * @returns The scraped transaction data response.
 */
export async function fetchTxnData(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): ReturnType<typeof fetchGetWithinPage<IScrapedTransactionData>> {
  const dataUrl = getTransactionsUrl(servicesUrl, monthMoment);
  await page.waitForTimeout(RATE_LIMIT_SLEEP_MS);
  LOG.debug(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  return fetchGetWithinPage<IScrapedTransactionData>(page, dataUrl);
}
