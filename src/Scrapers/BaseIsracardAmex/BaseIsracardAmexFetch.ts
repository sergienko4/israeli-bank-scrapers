import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage } from '../../Common/Fetch.js';
import { sleep } from '../../Common/Waiting.js';
import {
  type ScrapedAccount,
  type ScrapedAccountsWithinPageResponse,
  type ScrapedTransactionData,
} from './BaseIsracardAmexTypes.js';

const DATE_FORMAT = 'DD/MM/YYYY';
const RATE_LIMIT_SLEEP_BETWEEN = 1000;
const LOG = getDebug('base-isracard-amex');

function getAccountsUrl(servicesUrl: string, monthMoment: Moment): string {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}

export async function fetchAccounts(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): Promise<ScrapedAccount[]> {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  LOG.debug(`fetching accounts from ${dataUrl}`);
  const dataResult = await fetchGetWithinPage<ScrapedAccountsWithinPageResponse>(page, dataUrl);
  if (dataResult && _.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
    const { cardsCharges } = dataResult.DashboardMonthBean;
    if (!cardsCharges) return [];
    return cardsCharges.map(cardCharge => ({
      index: parseInt(cardCharge.cardIndex, 10),
      accountNumber: cardCharge.cardNumber,
      processedDate: moment(cardCharge.billingDate, DATE_FORMAT).toISOString(),
    }));
  }
  return [];
}

function getTransactionsUrl(servicesUrl: string, monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  url.searchParams.set('year', `${year}`);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}

export async function fetchTxnData(
  page: Page,
  servicesUrl: string,
  monthMoment: Moment,
): Promise<ScrapedTransactionData | null> {
  const dataUrl = getTransactionsUrl(servicesUrl, monthMoment);
  await sleep(RATE_LIMIT_SLEEP_BETWEEN);
  LOG.debug(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  return fetchGetWithinPage<ScrapedTransactionData>(page, dataUrl);
}
