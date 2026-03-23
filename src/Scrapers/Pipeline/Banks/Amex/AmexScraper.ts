/**
 * Amex pipeline scraper — monthly fetch via network discovery + BrowserFetchStrategy.
 * ZERO hardcoded URLs — discovers services endpoint from captured traffic.
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
import type { INetworkDiscovery } from '../../Mediator/NetworkDiscovery.js';
import type { IMonthlyConfig } from '../../Phases/MonthlyScrapeFactory.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/PipelineWellKnown.js';
import type { IFetchStrategy } from '../../Strategy/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../Strategy/FetchStrategy.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

// ── Discovery ──────────────────────────────────────────────

/**
 * Discover the services base URL from captured network traffic.
 * Uses WellKnown accounts patterns (DashboardMonth, etc.).
 * @param network - Network discovery from mediator.
 * @returns Discovered services URL or failure.
 */
function discoverServicesUrl(network: INetworkDiscovery): Procedure<string> {
  const hit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.accounts);
  if (!hit) return fail(ScraperErrorTypes.Generic, 'No accounts endpoint in traffic');
  const url = hit.url;
  const qIdx = url.indexOf('?');
  if (qIdx <= 0) return fail(ScraperErrorTypes.Generic, 'No query in discovered URL');
  const base = url.slice(0, qIdx);
  return succeed(base);
}

// ── URL Builders (from discovered base) ────────────────────

/**
 * Build accounts URL for one billing month.
 * @param servicesUrl - Discovered services URL.
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
 * @param servicesUrl - Discovered services URL.
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

// ── Mappers ────────────────────────────────────────────────

/**
 * Map API account charges to scraped account format.
 * @param charges - Card charges from DashboardMonth response.
 * @returns Array of scraped accounts with index.
 */
function mapCharges(
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

// ── Fetch context ──────────────────────────────────────────

/** Bundled fetch dependencies. */
interface IAmexFetchCtx {
  readonly strategy: IFetchStrategy;
  readonly servicesUrl: string;
}

/**
 * Fetch accounts for one billing month via fetchStrategy.
 * @param fc - Fetch context with strategy and discovered URL.
 * @param month - Billing month.
 * @returns Array of scraped accounts.
 */
async function fetchAccountsForMonth(fc: IAmexFetchCtx, month: Moment): Promise<IScrapedAccount[]> {
  const url = buildAccountsUrl(fc.servicesUrl, month);
  const raw = await fc.strategy.fetchGet<IScrapedAccountsWithinPageResponse>(
    url,
    DEFAULT_FETCH_OPTS,
  );
  if (!isOk(raw)) return [];
  const charges = raw.value.DashboardMonthBean?.cardsCharges;
  if (!charges) return [];
  return mapCharges(charges);
}

/**
 * Fetch transaction data for one billing month via fetchStrategy.
 * @param fc - Fetch context with strategy and discovered URL.
 * @param month - Billing month.
 * @returns Transaction data or false if empty.
 */
async function fetchTxnDataForMonth(
  fc: IAmexFetchCtx,
  month: Moment,
): Promise<IScrapedTransactionData | false> {
  const url = buildTxnsUrl(fc.servicesUrl, month);
  const raw = await fc.strategy.fetchGet<IScrapedTransactionData>(url, DEFAULT_FETCH_OPTS);
  if (!isOk(raw)) return false;
  return raw.value;
}

// ── Monthly fetch ──────────────────────────────────────────

/**
 * Build transaction accounts from raw API data.
 * @param accounts - Scraped accounts with index.
 * @param txnData - Raw transaction data.
 * @param options - Scraper options for filtering.
 * @returns Array of ITransactionsAccount.
 */
function buildMonthAccounts(
  accounts: IScrapedAccount[],
  txnData: IScrapedTransactionData,
  options: IPipelineContext['options'],
): ITransactionsAccount[] {
  const startMoment = moment(options.startDate);
  const accountTxns = buildAccountTxns({
    accounts,
    dataResult: txnData,
    options,
    startMoment,
  });
  return Object.values(accountTxns).map(
    (acct): ITransactionsAccount => ({
      accountNumber: acct.accountNumber,
      balance: 0,
      txns: acct.txns,
    }),
  );
}

/**
 * Fetch one month of Amex transactions via discovered endpoints.
 * @param ctx - Pipeline context with fetchStrategy + mediator.
 * @param month - Billing month.
 * @returns Accounts with transactions for the month.
 */
async function amexFetchOneMonth(
  ctx: IPipelineContext,
  month: Moment,
): Promise<Procedure<readonly ITransactionsAccount[]>> {
  if (!ctx.fetchStrategy.has) return fail(ScraperErrorTypes.Generic, 'No fetchStrategy');
  if (!ctx.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for discovery');
  const urlResult = discoverServicesUrl(ctx.mediator.value.network);
  if (!isOk(urlResult)) return urlResult;
  const fc: IAmexFetchCtx = { strategy: ctx.fetchStrategy.value, servicesUrl: urlResult.value };
  const accounts = await fetchAccountsForMonth(fc, month);
  if (accounts.length === 0) return succeed([]);
  const txnData = await fetchTxnDataForMonth(fc, month);
  if (!txnData) return succeed([]);
  if (!txnData.CardsTransactionsListBean) return succeed([]);
  const mapped = buildMonthAccounts(accounts, txnData, ctx.options);
  return succeed(mapped);
}

/** Amex monthly scrape configuration. */
const AMEX_MONTHLY: IMonthlyConfig = {
  defaultMonthsBack: 6,
  rateLimitMs: 1000,
  fetchMonth: amexFetchOneMonth,
};

export { AMEX_MONTHLY, amexFetchOneMonth };
