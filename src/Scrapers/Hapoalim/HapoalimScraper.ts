import moment from 'moment';
import { type Page } from 'playwright';
import { v4 as uuid4 } from 'uuid';

import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import {} from '../../Common/Navigation';
import { getRawTransaction } from '../../Common/Transactions';
import { waitUntil } from '../../Common/Waiting';
import { CompanyTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { HAPOALIM_CONFIG } from './HapoalimLoginConfig';

const LOG = getDebug('hapoalim');

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Hapoalim];

export interface IScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  IScrapedTransaction?: string;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
  additionalInformation?: unknown;
}

export interface IScrapedPfmTransaction {
  transactionNumber: number;
}

export type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

export interface IFetchedAccountTransactionsData {
  transactions: IScrapedTransaction[];
}

export interface IBalanceAndCreditLimit {
  creditLimitAmount: number;
  creditLimitDescription: string;
  creditLimitUtilizationAmount: number;
  creditLimitUtilizationExistanceCode: number;
  creditLimitUtilizationPercent: number;
  currentAccountLimitsAmount: number;
  currentBalance: number;
  withdrawalBalance: number;
}

/**
 * Builds a human-readable memo string from a Hapoalim transaction's beneficiary details.
 *
 * @param txn - the raw scraped transaction with optional beneficiary data
 * @returns a memo string with beneficiary info, or an empty string if no data
 */
function buildMemo(txn: IScrapedTransaction): string {
  if (!txn.beneficiaryDetailsData) return '';
  const { partyHeadline, partyName, messageHeadline, messageDetail } = txn.beneficiaryDetailsData;
  const memoLines: string[] = [];
  if (partyHeadline) memoLines.push(partyHeadline);
  if (partyName) memoLines.push(`${partyName}.`);
  if (messageHeadline) memoLines.push(messageHeadline);
  if (messageDetail) memoLines.push(`${messageDetail}.`);
  return memoLines.join(' ');
}

/**
 * Converts a single Hapoalim scraped transaction to a normalized ITransaction.
 *
 * @param txn - the raw scraped transaction
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized ITransaction object
 */
function convertOneTxn(txn: IScrapedTransaction, options?: ScraperOptions): ITransaction {
  const isOutbound = txn.eventActivityTypeCode === 2;
  const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
  const result: ITransaction = {
    type: TransactionTypes.Normal,
    identifier: txn.referenceNumber,
    date: moment(txn.eventDate, CFG.format.date).toISOString(),
    processedDate: moment(txn.valueDate, CFG.format.date).toISOString(),
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    description: txn.activityDescription ?? '',
    status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    memo: buildMemo(txn),
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Converts an array of scraped transactions to normalized ITransaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized ITransaction objects
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

/** Augmented window type for Hapoalim — exposes the bnhpApp global set by the bank's SPA. */
type HapoalimWindow = Window & { bnhpApp: { restContext: string } };

/**
 * Reads the restContext path from the bnhpApp global variable on the page.
 *
 * @param page - the Playwright page with the Hapoalim app loaded
 * @returns the REST context path used to build API URLs
 */
async function getRestContext(page: Page): Promise<string> {
  await waitUntil(() => {
    return page.evaluate(() => !!(window as unknown as HapoalimWindow).bnhpApp);
  }, 'waiting for app data load');
  const result = await page.evaluate(
    () => (window as unknown as HapoalimWindow).bnhpApp.restContext,
  );
  return result.slice(1);
}

/**
 * Performs a POST request with Hapoalim's XSRF token from the browser cookie jar.
 *
 * @param page - the Playwright page with an active Hapoalim session
 * @param url - the API endpoint URL to POST to
 * @param pageUuid - the page identifier to include in the request headers
 * @returns the fetched transaction data, or empty transactions if the request returned no body
 */
async function fetchPoalimXSRFWithinPage(
  page: Page,
  url: string,
  pageUuid: string,
): Promise<IFetchedAccountTransactionsData> {
  const cookies = await page.context().cookies();
  const xsrfCookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  const headers: Record<string, string> = {};
  if (xsrfCookie != null) {
    headers['X-XSRF-TOKEN'] = xsrfCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  const raw = await fetchPostWithinPage<IFetchedAccountTransactionsData>(page, url, {
    data: [],
    extraHeaders: headers,
  });
  return raw.isFound ? raw.value : { transactions: [] };
}

export interface IExtraScrapeOpts {
  txnsResult: IFetchedAccountTransactionsData;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

export interface IEnrichTransactionOpts {
  transaction: IScrapedTransaction;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

/**
 * Fetches additional PFM details for a single transaction and merges them in.
 *
 * @param opts - enrichment options with transaction, API base URL, page, and account number
 * @returns the transaction enriched with PFM reference number, or the original if unavailable
 */
async function enrichOneTxn(opts: IEnrichTransactionOpts): Promise<IScrapedTransaction> {
  const { transaction, baseUrl, page, accountNumber } = opts;
  const { pfmDetails, serialNumber } = transaction;
  if (serialNumber === 0) return transaction;
  const url = `${baseUrl}${pfmDetails}&accountId=${accountNumber}&lang=${CFG.format.apiLang}`;
  const extraResult = await fetchGetWithinPage<IScrapedPfmTransaction[]>(page, url);
  if (!extraResult.isFound || !extraResult.value.length) return transaction;
  const firstDetail = extraResult.value[0];
  if (!firstDetail.transactionNumber) return transaction;
  return {
    ...transaction,
    referenceNumber: firstDetail.transactionNumber,
    additionalInformation: extraResult.value,
  };
}

/**
 * Enriches all transactions in the result with additional PFM details in parallel.
 *
 * @param opts - options with transactions, API base URL, page, and account number
 * @returns the transaction result with all transactions enriched
 */
async function getExtraScrap(opts: IExtraScrapeOpts): Promise<IFetchedAccountTransactionsData> {
  const { txnsResult, baseUrl, page, accountNumber } = opts;
  const enrichPromises = txnsResult.transactions.map(t =>
    enrichOneTxn({ transaction: t, baseUrl, page, accountNumber }),
  );
  const res = await Promise.all(enrichPromises);
  return { transactions: res };
}

export interface IGetAccountTransactionsOpts {
  baseUrl: string;
  apiSiteUrl: string;
  page: Page;
  accountNumber: string;
  startDate: string;
  endDate: string;
  shouldAddTransactionInformation?: boolean;
  options?: ScraperOptions;
}

/**
 * Optionally enriches the transaction result with additional PFM data.
 *
 * @param txnsResult - the raw transaction result from the API
 * @param opts - options including the shouldAddTransactionInformation flag
 * @returns the enriched result or the original if enrichment is disabled
 */
async function enrichTxnsIfNeeded(
  txnsResult: IFetchedAccountTransactionsData,
  opts: IGetAccountTransactionsOpts,
): Promise<IFetchedAccountTransactionsData> {
  const { shouldAddTransactionInformation = false, baseUrl, page, accountNumber } = opts;
  if (shouldAddTransactionInformation && txnsResult.transactions.length)
    return getExtraScrap({ txnsResult, baseUrl, page, accountNumber });
  return txnsResult;
}

/**
 * Fetches and converts transactions for a single account within a date range.
 *
 * @param opts - options with API URLs, page, account number, dates, and scraper options
 * @returns normalized ITransaction objects for the account
 */
async function getAccountTransactions(opts: IGetAccountTransactionsOpts): Promise<ITransaction[]> {
  const { apiSiteUrl, accountNumber, startDate, endDate, page, options } = opts;
  const numItems = String(CFG.format.numItemsPerPage);
  const sortCode = String(CFG.format.sortCode);
  const txnsQuery =
    `accountId=${accountNumber}&numItemsPerPage=${numItems}` +
    `&retrievalEndDate=${endDate}&retrievalStartDate=${startDate}&sortCode=${sortCode}`;
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?${txnsQuery}`;
  const txnsResult = await fetchPoalimXSRFWithinPage(
    page,
    txnsUrl,
    '/current-account/transactions',
  );
  const finalResult = await enrichTxnsIfNeeded(txnsResult, opts);
  return convertTransactions(finalResult.transactions, options);
}

/**
 * Fetches the current balance for a single Hapoalim account.
 *
 * @param apiSiteUrl - the API site URL with the restContext path
 * @param page - the Playwright page with an active session
 * @param accountNumber - the account number to fetch the balance for
 * @returns the current balance as a number, or undefined if unavailable
 */
async function getAccountBalance(
  apiSiteUrl: string,
  page: Page,
  accountNumber: string,
): Promise<FoundResult<number>> {
  const balanceQuery = `accountId=${accountNumber}&view=details&lang=${CFG.format.apiLang}`;
  const balancePath = '/current-account/composite/balanceAndCreditLimit';
  const balanceAndCreditLimitUrl = `${apiSiteUrl}${balancePath}?${balanceQuery}`;
  const balanceResult = await fetchGetWithinPage<IBalanceAndCreditLimit>(
    page,
    balanceAndCreditLimitUrl,
  );
  if (!balanceResult.isFound) return { isFound: false };
  return { isFound: true, value: balanceResult.value.currentBalance };
}

export interface IFetchOneAccountOpts {
  page: Page;
  baseUrl: string;
  apiSiteUrl: string;
  account: FetchedAccountData[0];
  dateOpts: { startDateStr: string; endDateStr: string };
  options: ScraperOptions;
}

/**
 * Fetches balance and transactions for a single Hapoalim account.
 *
 * @param opts - options with page, URLs, account data, date options, and scraper options
 * @returns the account number, balance, and transactions
 */
async function fetchOneAccount(
  opts: IFetchOneAccountOpts,
): Promise<{ accountNumber: string; balance?: number; txns: ITransaction[] }> {
  const { page, baseUrl, apiSiteUrl, account, dateOpts, options } = opts;
  const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;
  LOG.info('getting information for account %s', accountNumber);
  const balanceResult = await getAccountBalance(apiSiteUrl, page, accountNumber);
  const balance = balanceResult.isFound ? balanceResult.value : undefined;
  const txns = await getAccountTransactions({
    baseUrl,
    apiSiteUrl,
    page,
    accountNumber,
    startDate: dateOpts.startDateStr,
    endDate: dateOpts.endDateStr,
    shouldAddTransactionInformation: options.shouldAddTransactionInformation,
    options,
  });
  return { accountNumber, balance, txns };
}

/**
 * Fetches the list of open accounts (not closed) from the Hapoalim accounts API.
 *
 * @param page - the Playwright page with an active Hapoalim session
 * @param baseUrl - the Hapoalim API base URL
 * @returns an array of open account data objects
 */
async function fetchOpenAccounts(page: Page, baseUrl: string): Promise<FetchedAccountData> {
  const accountsResult = await fetchGetWithinPage<FetchedAccountData>(
    page,
    `${baseUrl}/ServerServices/general/accounts`,
  );
  const accountsInfo: FetchedAccountData = accountsResult.isFound ? accountsResult.value : [];
  const openAccountsInfo = accountsInfo.filter(account => account.accountClosingReasonCode === 0);
  LOG.info(
    'got %d open accounts from %d total accounts, fetching txns and balance',
    openAccountsInfo.length,
    accountsInfo.length,
  );
  return openAccountsInfo;
}

/**
 * Builds the start and end date strings for Hapoalim API transaction queries.
 *
 * @param options - scraper options containing the user-specified start date
 * @returns start and end date strings in the Hapoalim API format
 */
function buildDateOpts(options: ScraperOptions): { startDateStr: string; endDateStr: string } {
  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const optionsStartMoment = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
  return {
    startDateStr: startMoment.format(CFG.format.date),
    endDateStr: moment().format(CFG.format.date),
  };
}

/**
 * Fetches all open account data and transactions for the logged-in Hapoalim user.
 *
 * @param page - the Playwright page with an active Hapoalim session
 * @param baseUrl - the Hapoalim API base URL
 * @param options - scraper options for date range and enrichment settings
 * @returns a successful scraping result with all account data
 */
async function fetchAccountData(
  page: Page,
  baseUrl: string,
  options: ScraperOptions,
): Promise<{
  success: boolean;
  accounts: { accountNumber: string; balance?: number; txns: ITransaction[] }[];
}> {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const openAccountsInfo = await fetchOpenAccounts(page, baseUrl);
  const dateOpts = buildDateOpts(options);
  const accountFetchPromises = openAccountsInfo.map(acc =>
    fetchOneAccount({ page, baseUrl, apiSiteUrl, account: acc, dateOpts, options }),
  );
  const accounts = await Promise.all(accountFetchPromises);
  LOG.info('fetching ended');
  return { success: true, accounts };
}

export interface IScraperSpecificCredentials {
  userCode: string;
  password: string;
}

/** IScraper implementation for Bank Hapoalim. */
class HapoalimScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Creates a HapoalimScraper with the standard Hapoalim login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, HAPOALIM_CONFIG);
  }

  /**
   * Fetches all account data and transactions for the Hapoalim user.
   *
   * @returns a successful scraping result with all open account transactions
   */
  /**
   * Fetches all account data and transactions for the Hapoalim user.
   *
   * @returns a successful scraping result with all open account transactions
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; balance?: number; txns: ITransaction[] }[];
  }> {
    return fetchAccountData(this.page, CFG.api.base, this.options);
  }
}

export default HapoalimScraper;
