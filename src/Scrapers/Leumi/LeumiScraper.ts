import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import {
  type IDashboardFieldOpts,
  resolveDashboardField,
  toFirstCss,
} from '../../Common/SelectorResolver';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { LEUMI_CONFIG } from './LeumiLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];
// SEL kept for fields not yet migrated to resolveDashboardField (accountListItems, accountCombo)
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;
const TRANSACTIONS_URL = CFG.urls.transactions;

export type LeumiDashKey = keyof typeof CFG.selectors;
// Typed key constants derived from config — no inline string literals in scraper code
const KEYS_ENTRIES = Object.keys(CFG.selectors).map(k => [k, k]);
const KEYS = Object.fromEntries(KEYS_ENTRIES) as {
  [K in LeumiDashKey]: K;
};

/**
 * Builds a IDashboardFieldOpts for a Leumi selector key using the shared config.
 *
 * @param page - the Playwright page to resolve the selector in
 * @param key - the Leumi dashboard selector key
 * @returns a IDashboardFieldOpts ready for resolveDashboardField()
 */
function dashOpts(page: Page, key: LeumiDashKey): IDashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}
const LEUMI_TRXS_PATH =
  '/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx';
const FILTERED_TRANSACTIONS_URL = `${CFG.api.base}${LEUMI_TRXS_PATH}`;

export interface ILeumiRawTransaction {
  DateUTC: string;
  Description?: string;
  ReferenceNumberLong?: number;
  AdditionalData?: string;
  Amount: number;
}

/**
 * Builds the core ITransaction fields from a raw Leumi transaction.
 *
 * @param rawTransaction - the raw transaction data from the Leumi API
 * @param status - the transaction status (pending or completed)
 * @param date - the ISO date string for this transaction
 * @returns a ITransaction object without rawTransaction
 */
function buildTxnBase(
  rawTransaction: ILeumiRawTransaction,
  status: TransactionStatuses,
  date: string,
): ITransaction {
  return {
    status,
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    description: rawTransaction.Description ?? '',
    identifier: rawTransaction.ReferenceNumberLong,
    memo: rawTransaction.AdditionalData ?? '',
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: rawTransaction.Amount,
    originalAmount: rawTransaction.Amount,
  };
}

/**
 * Maps a single raw Leumi transaction to a normalized ITransaction, optionally with raw data.
 *
 * @param rawTransaction - the raw transaction data from the Leumi API
 * @param status - the transaction status (pending or completed)
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized ITransaction object
 */
function mapOneTxn(
  rawTransaction: ILeumiRawTransaction,
  status: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction {
  const date = moment(rawTransaction.DateUTC).milliseconds(0).toISOString();
  const tx = buildTxnBase(rawTransaction, status, date);
  if (options?.includeRawTransaction) tx.rawTransaction = getRawTransaction(rawTransaction);
  return tx;
}

/**
 * Maps an array of raw Leumi transactions to normalized ITransaction objects.
 *
 * @param transactions - the raw transactions from the API (may be null)
 * @param status - the transaction status (pending or completed)
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized ITransaction objects, or empty if transactions is absent
 */
function extractTransactionsFromPage(
  transactions: ILeumiRawTransaction[],
  status: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction[] {
  if (transactions.length === 0) return [];
  return transactions.map(rawTransaction => mapOneTxn(rawTransaction, status, options));
}

/**
 * Returns a promise that resolves after a given timeout, used as a deliberate delay.
 *
 * @param timeout - the delay duration in milliseconds
 * @returns a done result after the timeout elapses
 */
function hangProcess(timeout: number): Promise<IDoneResult> {
  return new Promise<IDoneResult>(resolve => {
    setTimeout(() => {
      resolve({ done: true });
    }, timeout);
  });
}

/**
 * Waits for an element matching an XPath selector and clicks the first match.
 *
 * @param page - the Playwright page to search for the XPath element
 * @param xpath - the XPath selector string
 * @returns a done result after clicking the element
 */
async function clickByXPath(page: Page, xpath: string): Promise<IDoneResult> {
  await page.waitForSelector(xpath, { timeout: 30000, state: 'visible' });
  const elm = await page.$$(xpath);
  await elm[0].click();
  return { done: true };
}

/**
 * Strips non-numeric, non-slash, and non-dash characters from a string.
 *
 * @param str - the input string to clean
 * @returns the cleaned string with only digits, slashes, and dashes
 */
function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

export interface IFetchForAccountOpts {
  page: Page;
  startDate: Moment;
  accountId: string;
  options: ScraperOptions;
}

/**
 * Resolves a dashboard selector by key and clicks the resulting element.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Leumi dashboard selector key
 * @returns a done result after clicking, or done immediately if the element is not found
 */
async function resolveAndClick(page: Page, key: LeumiDashKey): Promise<IDoneResult> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved) return { done: true };
  await waitUntilElementFound(r.context, r.selector, { visible: true });
  await clickButton(r.context, r.selector);
  return { done: true };
}

/**
 * Opens the advanced search panel and applies the date range filter.
 *
 * @param page - the Playwright page showing the transaction search panel
 * @param startDate - the start date to apply to the date range filter
 * @returns a done result after applying the filter
 */
async function applyDateFilter(page: Page, startDate: Moment): Promise<IDoneResult> {
  await resolveAndClick(page, KEYS.advancedSearchBtn);
  await resolveAndClick(page, KEYS.dateRangeRadio);
  const dateFromInputOpts = dashOpts(page, KEYS.dateFromInput);
  const dateInput = await resolveDashboardField(dateFromInputOpts);
  if (dateInput.isResolved) {
    await waitUntilElementFound(dateInput.context, dateInput.selector, { visible: true });
    const formattedStartDate = startDate.format(CFG.format.date);
    await fillInput(dateInput.context, dateInput.selector, formattedStartDate);
  }
  await resolveAndClick(page, KEYS.filterBtn);
  return { done: true };
}

export interface ILeumiAccountResponse {
  BalanceDisplay?: string;

  TodayTransactionsItems: ILeumiRawTransaction[] | null;

  HistoryTransactionsItems: ILeumiRawTransaction[] | null;
}

/**
 * Parses the raw JSON response from the Leumi transaction API.
 *
 * @param responseJson - the raw API response wrapper
 * @param responseJson.jsonResp - the JSON string containing the actual response data
 * @returns the parsed ILeumiAccountResponse
 */
function parseAccountResponse(responseJson: { jsonResp: string }): ILeumiAccountResponse {
  return JSON.parse(responseJson.jsonResp) as ILeumiAccountResponse;
}

/**
 * Extracts and combines pending and completed transactions from the API response.
 *
 * @param response - the parsed Leumi account response with today and history transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns combined pending and completed transactions
 */
function buildTxnsFromResponse(
  response: ILeumiAccountResponse,
  options: ScraperOptions,
): ITransaction[] {
  const pending = extractTransactionsFromPage(
    response.TodayTransactionsItems ?? [],
    TransactionStatuses.Pending,
    options,
  );
  const completed = extractTransactionsFromPage(
    response.HistoryTransactionsItems ?? [],
    TransactionStatuses.Completed,
    options,
  );
  return [...pending, ...completed];
}

/**
 * Intercepts the Leumi filtered transactions API response after the date filter is applied.
 *
 * @param page - the Playwright page with an active Leumi session
 * @returns the parsed account response from the intercepted API call
 */
async function interceptFilteredResponse(page: Page): Promise<ILeumiAccountResponse> {
  const finalResponse = await page.waitForResponse(
    response =>
      response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST',
  );
  return parseAccountResponse((await finalResponse.json()) as { jsonResp: string });
}

/**
 * Sanitizes an account ID for safe display by replacing slashes with underscores.
 *
 * @param accountId - the raw account ID string from the Leumi UI
 * @returns a sanitized account ID string
 */
function sanitizeAccountId(accountId: string): string {
  return accountId.replace('/', '_').replace(/[^\d-_]/g, '');
}

/**
 * Applies the date filter and fetches transactions for a single account.
 *
 * @param opts - options with page, start date, account ID, and scraper options
 * @returns a ITransactionsAccount with account number, balance, and transactions
 */
async function fetchTransactionsForAccount(
  opts: IFetchForAccountOpts,
): Promise<ITransactionsAccount> {
  const { page, startDate, accountId, options } = opts;
  await hangProcess(4000);
  await applyDateFilter(page, startDate);
  const response = await interceptFilteredResponse(page);
  const accountNumber = sanitizeAccountId(accountId);
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;
  return { accountNumber, balance, txns: buildTxnsFromResponse(response, options) };
}

/**
 * Reads the list of account IDs from the Leumi dashboard account selector.
 *
 * @param page - the Playwright page showing the account list
 * @returns an array of account ID strings
 */
async function extractAccountIds(page: Page): Promise<string[]> {
  const accountListSelector = SEL.accountListItems;
  const ids = await page.evaluate(sel => {
    const elements = document.querySelectorAll(sel);
    return Array.from(elements, e => e.textContent);
  }, accountListSelector);
  if (!ids.length)
    throw new ScraperWebsiteChangedError('Leumi', 'Failed to extract or parse the account number');
  return ids;
}

/**
 * Switches to a specific account via the Leumi dashboard account combo box.
 *
 * @param page - the Playwright page showing the account dashboard
 * @param accountId - the account ID to switch to
 * @param totalAccounts - the total number of accounts (skip click if only one account)
 * @returns a done result after switching (or immediately if only one account)
 */
async function switchToAccount(
  page: Page,
  accountId: string,
  totalAccounts: number,
): Promise<IDoneResult> {
  if (totalAccounts <= 1) return { done: true };
  await clickByXPath(page, SEL.accountCombo);
  await clickByXPath(page, `xpath=//span[contains(text(), '${accountId}')]`);
  return { done: true };
}

export interface IFetchByIdOpts {
  page: Page;
  rawAccountId: string;
  totalAccounts: number;
  startDate: Moment;
  options: ScraperOptions;
}

/**
 * Switches to an account and fetches its transactions.
 *
 * @param opts - options with page, account ID, total account count, start date, and scraper options
 * @returns a ITransactionsAccount with account data and transactions
 */
async function fetchAccountById(opts: IFetchByIdOpts): Promise<ITransactionsAccount> {
  const { rawAccountId, totalAccounts, page, startDate, options } = opts;
  await switchToAccount(page, rawAccountId, totalAccounts);
  const accountId = removeSpecialCharacters(rawAccountId);
  return fetchTransactionsForAccount({ page, startDate, accountId, options });
}

/**
 * Fetches transactions for all Leumi accounts serially.
 *
 * @param page - the Playwright page with an active Leumi session
 * @param startDate - the earliest date to include in the transaction search
 * @param options - scraper options for rawTransaction inclusion
 * @returns an array of ITransactionsAccount objects for all accounts
 */
async function fetchTransactions(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<ITransactionsAccount[]> {
  await hangProcess(4000);
  const accountsIds = await extractAccountIds(page);
  const totalAccounts = accountsIds.length;
  const initialAccounts = Promise.resolve<ITransactionsAccount[]>([]);
  return accountsIds.reduce(
    async (acc, rawAccountId) => [
      ...(await acc),
      await fetchAccountById({ page, rawAccountId, totalAccounts, startDate, options }),
    ],
    initialAccounts,
  );
}

export interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** IScraper implementation for Bank Leumi. */
class LeumiScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Creates a LeumiScraper with the standard Leumi login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, LEUMI_CONFIG);
  }

  /**
   * Fetches transactions for all Leumi accounts.
   *
   * @returns a successful scraping result with all account transactions
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const minimumStartMoment = moment().subtract(3, 'years').add(1, 'day');
    const optionsStartMoment = moment(this.options.startDate);
    const startMoment = moment.max(minimumStartMoment, optionsStartMoment);

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchTransactions(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
