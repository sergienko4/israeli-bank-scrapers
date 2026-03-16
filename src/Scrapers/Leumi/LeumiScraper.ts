import { type Moment } from 'moment';
import moment from 'moment';
import { type Page } from 'playwright-core';

import { getDebug } from '../../Common/Debug.js';
import {
  clickButton,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import { candidateToCss } from '../../Common/SelectorResolver.js';
import { runSerial } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransactionsAccount } from '../../Transactions.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import LEUMI_CONFIG from './Config/LeumiLoginConfig.js';
import {
  buildTxnsFromResponse,
  type ILeumiAccountResponse,
  parseAccountResponse,
} from './LeumiTransactions.js';

const LOG = getDebug('leumi-scraper');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];

/** Resolve each bank selector entry to a Playwright-compatible string. */
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(
  ([k, cs]) => [k, candidateToCss(cs[0])] as const,
);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

const TRANSACTIONS_URL = CFG.urls.transactions;
const FILTERED_TRANSACTIONS_URL =
  `${CFG.api.base}/ChannelWCF/Broker.svc/ProcessRequest` +
  '?moduleName=UC_SO_27_GetBusinessAccountTrx';

/**
 * Wait for a fixed delay using the Playwright page timer.
 * @param page - The Playwright page instance.
 * @param timeout - The delay in milliseconds.
 * @returns True after the delay completes.
 */
async function delayViaPage(page: Page, timeout: number): Promise<boolean> {
  await page.waitForTimeout(timeout);
  return true;
}

/**
 * Click an element located by a Playwright selector (CSS or XPath).
 * @param page - The Playwright page instance.
 * @param selector - The Playwright-compatible selector string.
 * @returns True after the click completes.
 */
async function clickBySelector(page: Page, selector: string): Promise<boolean> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 30000 });
  await loc.click();
  return true;
}

/**
 * Remove non-numeric characters except digits, slashes, and dashes.
 * @param str - The string to sanitize.
 * @returns The sanitized string.
 */
function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

interface IFetchForAccountOpts {
  page: Page;
  startDate: Moment;
  accountId: string;
  options: ScraperOptions;
}

/**
 * Apply the date filter on the transactions page.
 * @param page - The Playwright page instance.
 * @param startDate - The start date for filtering.
 * @returns True after the filter is applied.
 */
async function applyDateFilter(page: Page, startDate: Moment): Promise<boolean> {
  await waitUntilElementFound(page, SEL.advancedSearchBtn, { visible: true });
  await clickButton(page, SEL.advancedSearchBtn);
  const dateRangeSelector = SEL.dateRangeRadio.split(':')[0];
  await waitUntilElementFound(page, dateRangeSelector, { visible: true });
  await clickButton(page, SEL.dateRangeRadio);
  await waitUntilElementFound(page, SEL.dateFromInput, { visible: true });
  const formattedDate = startDate.format(CFG.format.date);
  await fillInput(page, SEL.dateFromInput, formattedDate);
  await page.focus(SEL.filterBtn);
  await clickButton(page, SEL.filterBtn);
  return true;
}

/**
 * Intercept the filtered transactions API response and parse it.
 * @param page - The Playwright page instance.
 * @returns The parsed account response.
 */
async function interceptFilteredResponse(page: Page): Promise<ILeumiAccountResponse> {
  const finalResponse = await page.waitForResponse(
    response =>
      response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST',
  );
  const responseJson = (await finalResponse.json()) as { jsonResp: string };
  return parseAccountResponse(responseJson);
}

/**
 * Sanitize account ID for safe use as an identifier.
 * @param accountId - The raw account ID string.
 * @returns The sanitized account ID.
 */
function sanitizeAccountId(accountId: string): string {
  return accountId.replace('/', '_').replace(/[^\d-_]/g, '');
}

/**
 * Fetch transactions for a single account after applying date filter.
 * @param opts - The fetch options containing page, dates, and account info.
 * @returns The account transactions result.
 */
async function fetchTransactionsForAccount(
  opts: IFetchForAccountOpts,
): Promise<ITransactionsAccount> {
  const { page, startDate, accountId, options } = opts;
  await delayViaPage(page, 4000);
  await applyDateFilter(page, startDate);
  const response = await interceptFilteredResponse(page);
  const accountNumber = sanitizeAccountId(accountId);
  const balance = response.BalanceDisplay ? Number.parseFloat(response.BalanceDisplay) : undefined;
  return { accountNumber, balance, txns: buildTxnsFromResponse(response, options) };
}

/**
 * Extract account IDs from the account list elements on the page.
 * @param page - The Playwright page instance.
 * @returns The array of account ID strings.
 */
async function extractAccountIds(page: Page): Promise<string[]> {
  const textContentList = await page.evaluate((sel: string) => {
    const elements = document.querySelectorAll(sel);
    return Array.from(elements, e => e.textContent);
  }, SEL.accountListItems);
  if (!textContentList.length) {
    throw new ScraperError('Failed to extract or parse the account number');
  }
  return textContentList;
}

/**
 * Switch the active account in the UI dropdown.
 * @param page - The Playwright page instance.
 * @param accountId - The account ID to switch to.
 * @param totalAccounts - The total number of accounts.
 * @returns True if account was switched, false if only one account exists.
 */
async function switchToAccount(
  page: Page,
  accountId: string,
  totalAccounts: number,
): Promise<boolean> {
  if (totalAccounts <= 1) return false;
  await clickBySelector(page, SEL.accountCombo);
  const accountXpath = `xpath=//span[contains(text(), '${accountId}')]`;
  await clickBySelector(page, accountXpath);
  return true;
}

interface IFetchByIdOpts {
  page: Page;
  rawAccountId: string;
  totalAccounts: number;
  startDate: Moment;
  options: ScraperOptions;
}

/**
 * Fetch transactions for a specific account by raw ID.
 * @param opts - The fetch options for a specific account.
 * @returns The account transactions result.
 */
async function fetchAccountById(opts: IFetchByIdOpts): Promise<ITransactionsAccount> {
  const { rawAccountId, totalAccounts, page, startDate, options } = opts;
  const didSwitch = await switchToAccount(page, rawAccountId, totalAccounts);
  const masked = `***${rawAccountId.slice(-4)}`;
  LOG.debug('switchToAccount(%s): %s', masked, didSwitch ? 'switched' : 'skipped');
  const accountId = removeSpecialCharacters(rawAccountId);
  return fetchTransactionsForAccount({ page, startDate, accountId, options });
}

/**
 * Fetch transactions for all accounts sequentially.
 * @param page - The Playwright page instance.
 * @param startDate - The start date for filtering.
 * @param options - The scraper options.
 * @returns The array of account transaction results.
 */
async function fetchTransactions(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<ITransactionsAccount[]> {
  await delayViaPage(page, 4000);
  const accountsIds = await extractAccountIds(page);
  const totalAccounts = accountsIds.length;
  const actions = accountsIds.map(
    (rawAccountId): (() => Promise<ITransactionsAccount>) =>
      () =>
        fetchAccountById({ page, rawAccountId, totalAccounts, startDate, options }),
  );
  return runSerial(actions);
}

interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** Leumi bank scraper — fetches transaction data from Leumi online banking. */
class LeumiScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a Leumi scraper with the given options.
   * @param options - The scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, LEUMI_CONFIG);
  }

  /**
   * Fetch transaction data from Leumi online banking.
   * @returns The scraping result with accounts and transactions.
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
