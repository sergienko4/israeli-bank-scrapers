/**
 * Amex pipeline scraper — monthly fetch via BrowserFetchStrategy.
 * Reuses pure mapping functions from BaseIsracardAmex (no duplication).
 * All fetches through ctx.fetchStrategy (DI — injected by InitPhase).
 */

import type { Moment } from 'moment';
import moment from 'moment';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { buildAccountTxns } from '../../../BaseIsracardAmex/BaseIsracardAmexTransactions.js';
import type {
  IScrapedAccount,
  IScrapedAccountsWithinPageResponse,
  IScrapedTransactionData,
} from '../../../BaseIsracardAmex/BaseIsracardAmexTypes.js';
import type { IMonthlyConfig } from '../../Phases/MonthlyScrapeFactory.js';
import type { IFetchStrategy } from '../../Strategy/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../Strategy/FetchStrategy.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

/**
 * Build the services URL for Amex API.
 * @param config - Pipeline context config.
 * @returns Services URL.
 */
function getServicesUrl(config: IPipelineContext['config']): string {
  const apiBase = config.api.base ?? '';
  return `${apiBase}/services/ProxyRequestHandler.ashx`;
}

/**
 * Build accounts URL for one billing month.
 * @param servicesUrl - Base services URL.
 * @param month - Billing month.
 * @returns Full URL with query params.
 */
function buildAccountsUrl(servicesUrl: string, month: Moment): string {
  const billingDate = month.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}

/**
 * Build transactions URL for one billing month.
 * @param servicesUrl - Base services URL.
 * @param month - Billing month.
 * @returns Full URL with query params.
 */
function buildTxnsUrl(servicesUrl: string, month: Moment): string {
  const billingDate = month.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', billingDate);
  url.searchParams.set('actionCode', '0');
  return url.toString();
}

/**
 * Map API account charges to scraped account format.
 * @param charges - Card charges from DashboardMonth response.
 * @returns Array of scraped accounts with index.
 */
function mapAccounts(
  charges: NonNullable<
    NonNullable<IScrapedAccountsWithinPageResponse['DashboardMonthBean']>['cardsCharges']
  >,
): IScrapedAccount[] {
  return charges.map(
    (card, idx): IScrapedAccount => ({
      index: idx,
      accountNumber: card.cardNumber,
      processedDate: card.billingDate,
    }),
  );
}

/**
 * Fetch accounts for one billing month via fetchStrategy.
 * @param strategy - Injected fetch strategy.
 * @param servicesUrl - API services URL.
 * @param month - Billing month.
 * @returns Array of scraped accounts.
 */
async function fetchAccountsForMonth(
  strategy: IFetchStrategy,
  servicesUrl: string,
  month: Moment,
): Promise<IScrapedAccount[]> {
  const url = buildAccountsUrl(servicesUrl, month);
  const raw = await strategy.fetchGet<IScrapedAccountsWithinPageResponse>(url, DEFAULT_FETCH_OPTS);
  if (!isOk(raw)) return [];
  const charges = raw.value.DashboardMonthBean?.cardsCharges;
  if (!charges) return [];
  return mapAccounts(charges);
}

/**
 * Fetch transaction data for one billing month via fetchStrategy.
 * @param strategy - Injected fetch strategy.
 * @param servicesUrl - API services URL.
 * @param month - Billing month.
 * @returns Transaction data or false if empty.
 */
async function fetchTxnDataForMonth(
  strategy: IFetchStrategy,
  servicesUrl: string,
  month: Moment,
): Promise<IScrapedTransactionData | false> {
  const url = buildTxnsUrl(servicesUrl, month);
  const raw = await strategy.fetchGet<IScrapedTransactionData>(url, DEFAULT_FETCH_OPTS);
  if (!isOk(raw)) return false;
  return raw.value;
}

/**
 * Fetch one month of Amex transactions via fetchStrategy.
 * @param ctx - Pipeline context with fetchStrategy.
 * @param month - Billing month.
 * @returns Accounts with transactions for the month.
 */
async function amexFetchOneMonth(
  ctx: IPipelineContext,
  month: Moment,
): Promise<Procedure<readonly ITransactionsAccount[]>> {
  if (!ctx.fetchStrategy.has) return fail(ScraperErrorTypes.Generic, 'No fetchStrategy');
  const strategy = ctx.fetchStrategy.value;
  const servicesUrl = getServicesUrl(ctx.config);
  const accounts = await fetchAccountsForMonth(strategy, servicesUrl, month);
  if (accounts.length === 0) return succeed([]);
  const txnData = await fetchTxnDataForMonth(strategy, servicesUrl, month);
  if (!txnData) return succeed([]);
  if (!txnData.CardsTransactionsListBean) return succeed([]);
  const startMoment = moment(ctx.options.startDate);
  const accountTxns = buildAccountTxns({
    accounts,
    dataResult: txnData,
    options: ctx.options,
    startMoment,
  });
  const result: ITransactionsAccount[] = Object.values(accountTxns).map(
    (acct): ITransactionsAccount => ({
      accountNumber: acct.accountNumber,
      balance: 0,
      txns: acct.txns,
    }),
  );
  return succeed(result);
}

/** Amex monthly scrape configuration. */
const AMEX_MONTHLY: IMonthlyConfig = {
  defaultMonthsBack: 6,
  rateLimitMs: 1000,
  fetchMonth: amexFetchOneMonth,
};

export { AMEX_MONTHLY, amexFetchOneMonth };
