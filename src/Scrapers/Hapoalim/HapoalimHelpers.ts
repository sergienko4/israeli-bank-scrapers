import moment from 'moment';
import { type Page } from 'playwright-core';
import { v4 as uuid4 } from 'uuid';

import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { waitUntil } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';

const LOG = getDebug('hapoalim');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Hapoalim];

/** Scraped transaction shape from Hapoalim API. */
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

/** PFM transaction detail shape. */
interface IScrapedFinanceTransaction {
  transactionNumber: number;
}

/** Fetched account data shape. */
export type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

/** Fetched account transactions data. */
interface ITransactionData {
  transactions: IScrapedTransaction[];
}

/** Balance and credit limit response shape. */
interface IBalanceAndCreditLimit {
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
 * Build a memo string from beneficiary details.
 * @param txn - The scraped transaction.
 * @returns The composed memo string.
 */
function buildMemo(txn: IScrapedTransaction): string {
  if (!txn.beneficiaryDetailsData) return '';
  const { partyHeadline, partyName, messageHeadline, messageDetail } = txn.beneficiaryDetailsData;
  const lines: string[] = [];
  if (partyHeadline) lines.push(partyHeadline);
  if (partyName) lines.push(`${partyName}.`);
  if (messageHeadline) lines.push(messageHeadline);
  if (messageDetail) lines.push(`${messageDetail}.`);
  return lines.join(' ');
}

/**
 * Build base transaction fields.
 * @param txn - The scraped transaction.
 * @returns The base ITransaction without rawTransaction.
 */
function buildTxnBase(txn: IScrapedTransaction): Omit<ITransaction, 'rawTransaction'> {
  const isOutbound = txn.eventActivityTypeCode === 2;
  const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
  const dateVal = moment(txn.eventDate, CFG.format.date);
  const processedVal = moment(txn.valueDate, CFG.format.date);
  return {
    type: TransactionTypes.Normal,
    identifier: txn.referenceNumber,
    date: dateVal.toISOString(),
    processedDate: processedVal.toISOString(),
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    description: txn.activityDescription ?? '',
    status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    memo: buildMemo(txn),
  };
}

/**
 * Convert a single scraped transaction to normalized shape.
 * @param txn - The scraped transaction.
 * @param options - Scraper options.
 * @returns The normalized ITransaction.
 */
function convertOneTxn(txn: IScrapedTransaction, options?: ScraperOptions): ITransaction {
  const result: ITransaction = buildTxnBase(txn);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Convert an array of scraped transactions.
 * @param txns - Array of scraped transactions.
 * @param options - Scraper options.
 * @returns Array of normalized ITransactions.
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

/** Shape of the bank's runtime window extension. */
interface IHapoalimWindow extends Window {
  bnhpApp: { restContext: string };
}

/**
 * Check if the bank SPA runtime data is loaded.
 * @param page - The Playwright page.
 * @returns True when the app object exists.
 */
async function isBankAppReady(page: Page): Promise<boolean> {
  return page.evaluate(() => !!(window as unknown as IHapoalimWindow).bnhpApp);
}

/**
 * Get the REST context path from the bank SPA.
 * @param page - The Playwright page.
 * @returns The REST context path string.
 */
async function getRestContext(page: Page): Promise<string> {
  await waitUntil(() => isBankAppReady(page), 'waiting for app data load');
  const ctx = await page.evaluate(() => (window as unknown as IHapoalimWindow).bnhpApp.restContext);
  return ctx.slice(1);
}

/**
 * Build XSRF headers from page cookies.
 * @param page - The Playwright page.
 * @param pageUuid - The page UUID for the request.
 * @returns Headers object with XSRF token.
 */
async function buildXsrfHeaders(page: Page, pageUuid: string): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const xsrf = cookies.find(c => c.name === 'XSRF-TOKEN');
  const headers: Record<string, string> = {};
  if (xsrf != null) headers['X-XSRF-TOKEN'] = xsrf.value;
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return headers;
}

/**
 * Fetch account transactions with XSRF authentication.
 * @param page - The Playwright page.
 * @param url - The API URL.
 * @param pageUuid - The page UUID for the request.
 * @returns The fetched transaction data.
 */
async function fetchWithXsrf(page: Page, url: string, pageUuid: string): Promise<ITransactionData> {
  const headers = await buildXsrfHeaders(page, pageUuid);
  const result = await fetchPostWithinPage<ITransactionData>(page, url, {
    data: [],
    extraHeaders: headers,
  });
  if (!result) return { transactions: [] } as ITransactionData;
  return result;
}

/** Options for enriching a single transaction. */
interface IEnrichOpts {
  transaction: IScrapedTransaction;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

/**
 * Enrich a single transaction with PFM details.
 * @param opts - The enrichment options.
 * @returns The enriched transaction.
 */
async function enrichOneTxn(opts: IEnrichOpts): Promise<IScrapedTransaction> {
  const { transaction, baseUrl, page, accountNumber } = opts;
  if (transaction.serialNumber === 0) return transaction;
  const url =
    `${baseUrl}${transaction.pfmDetails}` +
    `&accountId=${accountNumber}` +
    `&lang=${CFG.format.apiLang}`;
  const details = await fetchGetWithinPage<IScrapedFinanceTransaction[]>(page, url);
  if (!details || details.length === 0) return transaction;
  const first = details[0];
  if (!first.transactionNumber) return transaction;
  return {
    ...transaction,
    referenceNumber: first.transactionNumber,
    additionalInformation: details,
  };
}

/** Options for fetching account transactions. */
export interface IGetAccountTxnsOpts {
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
 * Enrich all transactions if configured.
 * @param txns - The raw transaction data.
 * @param opts - The account transaction options.
 * @returns The enriched transaction data.
 */
async function enrichIfNeeded(
  txns: ITransactionData,
  opts: IGetAccountTxnsOpts,
): Promise<ITransactionData> {
  const { shouldAddTransactionInformation = false } = opts;
  if (!shouldAddTransactionInformation) return txns;
  if (txns.transactions.length === 0) return txns;
  const { baseUrl, page, accountNumber } = opts;
  const promises = txns.transactions.map(t =>
    enrichOneTxn({ transaction: t, baseUrl, page, accountNumber }),
  );
  const enriched = await Promise.all(promises);
  return { transactions: enriched };
}

/** Parameters for building the transactions URL. */
interface IBuildTransactionUrlOpts {
  apiSiteUrl: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
}

/**
 * Build the transactions URL with query parameters.
 * @param opts - The URL building parameters.
 * @returns The full transactions URL.
 */
function buildTxnUrl(opts: IBuildTransactionUrlOpts): string {
  const { apiSiteUrl, accountNumber, startDate, endDate } = opts;
  const numItems = String(CFG.format.numItemsPerPage);
  const sortCode = String(CFG.format.sortCode);
  return (
    `${apiSiteUrl}/current-account/transactions` +
    `?accountId=${accountNumber}` +
    `&numItemsPerPage=${numItems}` +
    `&retrievalEndDate=${endDate}` +
    `&retrievalStartDate=${startDate}` +
    `&sortCode=${sortCode}`
  );
}

/**
 * Fetch and convert transactions for a single account.
 * @param opts - The account transaction options.
 * @returns Converted ITransactions for this account.
 */
export async function getAccountTransactions(opts: IGetAccountTxnsOpts): Promise<ITransaction[]> {
  const { apiSiteUrl, accountNumber, startDate, endDate, page, options } = opts;
  const url = buildTxnUrl({ apiSiteUrl, accountNumber, startDate, endDate });
  const raw = await fetchWithXsrf(page, url, '/current-account/transactions');
  const final = await enrichIfNeeded(raw, opts);
  return convertTransactions(final.transactions, options);
}

/** Balance result — wraps an optional numeric value. */
export interface IBalanceResult {
  value: number;
  hasBalance: true;
}
/** Empty balance result when the API returns no data. */
export interface INoBalance {
  hasBalance: false;
}

/**
 * Fetch the current balance for an account.
 * @param apiSiteUrl - The API base URL with context.
 * @param page - The Playwright page.
 * @param accountNumber - The account ID.
 * @returns The balance result.
 */
export async function getAccountBalance(
  apiSiteUrl: string,
  page: Page,
  accountNumber: string,
): Promise<IBalanceResult | INoBalance> {
  const apiLang = CFG.format.apiLang;
  const url =
    `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit` +
    `?accountId=${accountNumber}&view=details&lang=${apiLang}`;
  const data = await fetchGetWithinPage<IBalanceAndCreditLimit>(page, url);
  if (!data) return { hasBalance: false };
  return { value: data.currentBalance, hasBalance: true };
}

/** Options for fetching a single account. */
export interface IFetchOneAccountOpts {
  page: Page;
  baseUrl: string;
  apiSiteUrl: string;
  account: FetchedAccountData[0];
  dateOpts: { startDateStr: string; endDateStr: string };
  options: ScraperOptions;
}

/** Single account result shape. */
export interface IAccountResult {
  accountNumber: string;
  balance: number | undefined;
  txns: ITransaction[];
}

/**
 * Fetch balance and transactions for one account.
 * @param opts - The account fetch options.
 * @returns The account result with balance and transactions.
 */
export async function fetchOneAccount(opts: IFetchOneAccountOpts): Promise<IAccountResult> {
  const { page, baseUrl, apiSiteUrl, account, dateOpts, options } = opts;
  const accountNumber = buildAccountNumber(account);
  LOG.debug('getting information for account %s', accountNumber);
  const balanceResult = await getAccountBalance(apiSiteUrl, page, accountNumber);
  const balance = balanceResult.hasBalance ? balanceResult.value : undefined;
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
 * Build the composite account number string from account data.
 * @param account - The account data containing bank, branch, and account numbers.
 * @returns The formatted account number.
 */
function buildAccountNumber(account: FetchedAccountData[0]): string {
  return `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;
}

/**
 * Fetch the list of open accounts.
 * @param page - The Playwright page.
 * @param baseUrl - The base URL for the API.
 * @returns Array of open account data.
 */
export async function fetchOpenAccounts(page: Page, baseUrl: string): Promise<FetchedAccountData> {
  const url = `${baseUrl}/ServerServices/general/accounts`;
  const all = await fetchGetWithinPage<FetchedAccountData>(page, url);
  if (!all) return [];
  const open = all.filter(a => a.accountClosingReasonCode === 0);
  LOG.debug(
    'got %d open accounts from %d total, fetching txns and balance',
    open.length,
    all.length,
  );
  return open;
}

/**
 * Build start and end date strings for the API.
 * @param options - Scraper options with start date.
 * @returns The formatted date strings.
 */
export function buildDateOpts(options: ScraperOptions): {
  startDateStr: string;
  endDateStr: string;
} {
  const defaultStart = moment().subtract(1, 'years').add(1, 'day');
  const optStart = moment(options.startDate);
  const start = moment.max(defaultStart, optStart);
  return {
    startDateStr: start.format(CFG.format.date),
    endDateStr: moment().format(CFG.format.date),
  };
}

export { getRestContext as getContext };
