import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import {
  type DashboardFieldOpts,
  type FieldContext,
  resolveDashboardField,
  toFirstCss,
} from '../../Common/SelectorResolver';
import { CompanyTypes } from '../../Definitions';
import {
  type Transaction,
  type TransactionsAccount,
  TransactionStatuses,
} from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import {
  getAccountIdsBothUIs,
  getTransactionsFrame,
  selectAccountFromDropdown,
} from '../Beinleumi/BeinleumiAccountSelector';
export {
  clickAccountSelectorGetAccountIds,
  selectAccountFromDropdown,
} from '../Beinleumi/BeinleumiAccountSelector';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  convertTransactions,
  ERROR_MESSAGE_CLASS,
  extractTransaction,
  getTransactionsColsTypeClasses,
  isNoTransactionInDateRangeError,
  type ScrapedTransaction,
  type TransactionsTr,
} from './BaseBeinleumiGroupHelpers';

// All Beinleumi group banks share the same selectors and timing
const BEINLEUMI_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi];
const SEL = BEINLEUMI_CFG.selectors;
const ELEMENT_RENDER_TIMEOUT_MS = BEINLEUMI_CFG.timing.elementRenderMs;

// ─── Dashboard resolution helpers ────────────────────────────────────────────

/**
 * Builds a DashboardFieldOpts for the given selector key using the shared Beinleumi config.
 *
 * @param ctx - the page or frame to resolve the selector in
 * @param key - the selector key from the Beinleumi scraper config
 * @returns a DashboardFieldOpts ready for resolveDashboardField()
 */
function dashOpts(ctx: Page | Frame, key: string): DashboardFieldOpts {
  return {
    pageOrFrame: ctx,
    fieldKey: key,
    bankCandidates: [...(SEL[key] ?? [])],
    pageUrl: ctx.url(),
  };
}

/**
 * Resolves a selector by key and clicks the resulting element.
 *
 * @param ctx - the page or frame to search for the element
 * @param key - the selector key to resolve
 */
async function resolveAndClick(ctx: Page | Frame, key: string): Promise<void> {
  const fieldOpts = dashOpts(ctx, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved)
    throw new ScraperWebsiteChangedError('Beinleumi', `selector '${key}' not found`);
  await clickButton(r.context, r.selector);
}

/**
 * Resolves a selector by key and fills the resulting input with a value.
 *
 * @param ctx - the page or frame to search for the input element
 * @param key - the selector key to resolve
 * @param value - the text to type into the resolved input
 */
async function resolveAndFill(ctx: Page | Frame, key: string, value: string): Promise<void> {
  const fieldOpts = dashOpts(ctx, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved)
    throw new ScraperWebsiteChangedError('Beinleumi', `selector '${key}' not found`);
  await fillInput(r.context, r.selector, value);
}

/**
 * Resolves a selector by key and waits for the resulting element to appear.
 *
 * @param ctx - the page or frame to search for the element
 * @param key - the selector key to resolve
 * @param opts - optional wait parameters for waitUntilElementFound
 * @param opts.visible - whether to wait for the element to be visible
 * @param opts.timeout - custom timeout in milliseconds
 * @returns the resolved FieldContext with context and selector
 */
async function resolveAndWait(
  ctx: Page | Frame,
  key: string,
  opts?: { visible?: boolean; timeout?: number },
): Promise<FieldContext> {
  const fieldOpts = dashOpts(ctx, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved)
    throw new ScraperWebsiteChangedError('Beinleumi', `selector '${key}' not found`);
  await waitUntilElementFound(r.context, r.selector, opts ?? {});
  return r;
}

/**
 * Resolves a selector by key and returns the CSS selector string.
 *
 * @param ctx - the page or frame to search for the element
 * @param key - the selector key to resolve
 * @returns the resolved CSS selector string
 */
async function resolveSelectorCss(ctx: Page | Frame, key: string): Promise<string> {
  const fieldOpts = dashOpts(ctx, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved)
    throw new ScraperWebsiteChangedError('Beinleumi', `selector '${key}' not found`);
  return r.selector;
}

// ─── Data extraction ──────────────────────────────────────────────────────────

/**
 * Extracts raw transaction rows from a table on the page.
 *
 * @param page - the page or frame containing the transactions table
 * @param tableLocator - CSS selector for the transactions table
 * @param transactionStatus - whether to extract pending or completed transactions
 * @returns an array of raw scraped transaction objects
 */
async function extractTransactions(
  page: Page | Frame,
  tableLocator: string,
  transactionStatus: TransactionStatuses,
): Promise<ScrapedTransaction[]> {
  const txns: ScrapedTransaction[] = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await pageEvalAll<TransactionsTr[]>(page, {
    selector: `${tableLocator} tbody tr`,
    defaultResult: [],
    /**
     * Maps each table row to an object containing its cell text values.
     *
     * @param trs - the array of tr elements from the transactions table
     * @returns an array of objects with the innerText of each td
     */
    callback: trs =>
      trs.map(tr => ({ innerTds: [...tr.getElementsByTagName('td')].map(td => td.innerText) })),
  });
  for (const txnRow of transactionsRows) {
    extractTransaction({ txns, transactionStatus, txnRow, transactionsColsTypes });
  }
  return txns;
}

/**
 * Navigates to the transactions tab and filters results by start date.
 *
 * @param page - the page or frame containing the date filter controls
 * @param startDate - the earliest date to include in the transaction search
 */
async function searchByDates(page: Page | Frame, startDate: Moment): Promise<void> {
  await resolveAndClick(page, 'transactionsTab');
  await resolveAndWait(page, 'datesContainer');
  const formattedStartDate = startDate.format(BEINLEUMI_CFG.format.date);
  await resolveAndFill(page, 'fromDateInput', formattedStartDate);
  await resolveAndClick(page, 'closeDatePickerBtn');
  await resolveAndClick(page, 'showButton');
  await waitForNavigation(page);
}

/**
 * Reads the account number displayed on the dashboard.
 *
 * @param page - the page or frame containing the account number element
 * @returns the account number string (slashes replaced with underscores)
 */
async function getAccountNumber(page: Page | Frame): Promise<string> {
  const r = await resolveAndWait(page, 'accountsNumber', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const text = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  return text.replace('/', '_').trim();
}

/**
 * Resolves the "next page" link CSS selector, returning an empty string when pagination is off or absent.
 *
 * @param page - the page or frame to search for the next-page link
 * @param shouldPaginate - whether pagination is enabled for this query
 * @returns the CSS selector for the next-page link, or an empty string if not found
 */
async function resolveNextLinkCss(page: Page | Frame, shouldPaginate: boolean): Promise<string> {
  if (!shouldPaginate) return '';
  const nextLinkOpts = dashOpts(page, 'nextPageLink');
  const r = await resolveDashboardField(nextLinkOpts);
  return r.isResolved ? r.selector : '';
}

/**
 * Recursively collects transactions across multiple pages, following the next-page link.
 *
 * @param opts - pagination options
 * @param opts.page - the page or frame containing the transactions table
 * @param opts.tableLocator - CSS selector for the transactions table
 * @param opts.transactionStatus - whether to extract pending or completed transactions
 * @param opts.nextLinkCss - CSS selector for the next-page link
 * @param previousTxns - transactions collected from previous pages (used in recursive calls)
 * @returns all collected transactions across all pages
 */
async function collectPages(
  opts: {
    page: Page | Frame;
    tableLocator: string;
    transactionStatus: TransactionStatuses;
    nextLinkCss: string;
  },
  previousTxns: ScrapedTransaction[] = [],
): Promise<ScrapedTransaction[]> {
  const { page, tableLocator, transactionStatus, nextLinkCss } = opts;
  const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
  const allTxns = [...previousTxns, ...currentPageTxns];
  const hasNextPage = nextLinkCss !== '' && (await elementPresentOnPage(page, nextLinkCss));
  if (!hasNextPage) return allTxns;
  await clickButton(page, nextLinkCss);
  await waitForNavigation(page);
  return collectPages(opts, allTxns);
}

/**
 * Scrapes all transactions from a table, handling pagination and conversion.
 *
 * @param opts - scrape options
 * @param opts.page - the page or frame containing the transactions table
 * @param opts.tableLocator - CSS selector for the transactions table
 * @param opts.transactionStatus - whether to extract pending or completed transactions
 * @param opts.shouldPaginate - whether to follow next-page links
 * @param opts.options - scraper options for rawTransaction inclusion
 * @returns converted Transaction objects from all pages
 */
async function scrapeTransactions(opts: {
  page: Page | Frame;
  tableLocator: string;
  transactionStatus: TransactionStatuses;
  shouldPaginate: boolean;
  options?: ScraperOptions;
}): Promise<Transaction[]> {
  const { page, tableLocator, transactionStatus, shouldPaginate, options } = opts;
  const nextLinkCss = await resolveNextLinkCss(page, shouldPaginate);
  const txns = await collectPages({ page, tableLocator, transactionStatus, nextLinkCss });
  return convertTransactions(txns, options);
}

/**
 * Resolves a table by selector key and scrapes its transactions, returning [] if the table is absent.
 *
 * @param page - the page or frame to look for the table
 * @param key - the selector key for the transaction table in the Beinleumi config
 * @param opts - scrape options
 * @param opts.status - whether to extract pending or completed transactions
 * @param opts.shouldPaginate - whether to follow next-page links
 * @param opts.options - scraper options for rawTransaction inclusion
 * @returns converted Transaction objects, or an empty array if the table is not present
 */
async function scrapeTableByKey(
  page: Page | Frame,
  key: string,
  opts: { status: TransactionStatuses; shouldPaginate: boolean; options?: ScraperOptions },
): Promise<Transaction[]> {
  const tableKeyOpts = dashOpts(page, key);
  const r = await resolveDashboardField(tableKeyOpts);
  if (!r.isResolved) return []; // table absent from DOM (e.g. no pending txns for period)
  return scrapeTransactions({
    page,
    tableLocator: r.selector,
    transactionStatus: opts.status,
    shouldPaginate: opts.shouldPaginate,
    options: opts.options,
  });
}

/**
 * Fetches both pending and completed transactions from the current account view.
 *
 * @param page - the page or frame showing the transaction tables
 * @param options - scraper options (used for rawTransaction inclusion)
 * @returns combined list of pending and completed transactions
 */
async function fetchPendingAndCompleted(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  const pending = await scrapeTableByKey(page, 'pendingTransactionsTable', {
    status: TransactionStatuses.Pending,
    shouldPaginate: false,
    options,
  });
  const completed = await scrapeTableByKey(page, 'completedTransactionsTable', {
    status: TransactionStatuses.Completed,
    shouldPaginate: true,
    options,
  });
  return [...pending, ...completed];
}

/**
 * Waits for the transaction table or error element, then fetches all transactions.
 *
 * @param page - the page or frame showing the transaction results
 * @param options - scraper options (used for rawTransaction inclusion)
 * @returns all transactions for the current account and date range
 */
async function getAccountTransactions(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  const tableContainerCss = await resolveSelectorCss(page, 'tableContainer');
  await Promise.race([
    waitUntilElementFound(page, tableContainerCss, { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  return fetchPendingAndCompleted(page, options);
}

/**
 * Reads the current account balance from the dashboard.
 *
 * @param page - the page or frame showing the balance element
 * @returns the current balance as a floating-point number
 */
async function getCurrentBalance(page: Page | Frame): Promise<number> {
  const r = await resolveAndWait(page, 'currentBalance', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const balanceStr = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  const normalizedBalance = balanceStr.replace(/[^0-9.,-]/g, '').replaceAll(',', '');
  return parseFloat(normalizedBalance);
}

/**
 * Waits for any of several post-login indicators to appear, signaling a completed login.
 *
 * @param page - the Playwright page to monitor after login submission
 * @returns a promise that resolves when the first post-login indicator appears
 */
export async function waitForPostLogin(page: Page): Promise<void> {
  return Promise.race([
    waitUntilElementFound(page, '#card-header', { visible: false }),
    waitUntilElementFound(page, '#account_num', { visible: true }),
    waitUntilElementFound(page, '#matafLogoutLink', { visible: true }),
    waitUntilElementFound(page, '#validationMsg', { visible: true }),
  ]);
}

/**
 * Fetches account number, balance, and transactions for a single account.
 *
 * @param page - the page or frame showing the account dashboard
 * @param startDate - the earliest date to include in the transaction search
 * @param options - scraper options (used for rawTransaction inclusion)
 * @returns a TransactionsAccount with account number, balance, and transactions
 */
async function fetchAccountData(
  page: Page | Frame,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber, txns, balance };
}

/**
 * Selects an account using either the modern dropdown or the legacy select element.
 *
 * @param page - the Playwright page containing the account selector
 * @param accountId - the account identifier to select
 */
async function selectAccountBothUIs(page: Page, accountId: string): Promise<void> {
  const isAccountSelected = await selectAccountFromDropdown(page, accountId);
  if (!isAccountSelected) {
    await page.selectOption('#account_num_select', accountId);
    await waitUntilElementFound(page, '#account_num_select', { visible: true });
  }
}

/**
 * Fetches account data supporting both the new iframe-based and legacy direct-page UIs.
 *
 * @param page - the Playwright page (transactions may be inside an iframe)
 * @param startDate - the earliest date to include in the transaction search
 * @param options - scraper options (used for rawTransaction inclusion)
 * @returns a TransactionsAccount with account number, balance, and transactions
 */
async function fetchAccountDataBothUIs(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  const frame = await getTransactionsFrame(page);
  return fetchAccountData(frame ?? page, startDate, options);
}

/**
 * Iterates over all account IDs and fetches transaction data for each one.
 *
 * @param page - the Playwright page showing the account selector
 * @param startDate - the earliest date to include in the transaction search
 * @param options - scraper options (used for rawTransaction inclusion)
 * @returns an array of TransactionsAccount objects, one per account
 */
async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) return [await fetchAccountDataBothUIs(page, startDate, options)];
  const emptyAccounts = Promise.resolve([] as TransactionsAccount[]);
  return accountsIds.reduce(async (prevPromise, accountId) => {
    const acc = await prevPromise;
    await selectAccountBothUIs(page, accountId);
    acc.push(await fetchAccountDataBothUIs(page, startDate, options));
    return acc;
  }, emptyAccounts);
}

/** Abstract base scraper shared by all Beinleumi-group banks (Beinleumi, Massad, Behatsdaa, etc.). */
abstract class BeinleumiGroupBaseScraper extends GenericBankScraper<{
  username: string;
  password: string;
}> {
  /**
   * Navigates to the transactions portal and fetches data for all accounts.
   *
   * @returns a successful scraping result with all account transactions
   */
  public async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const startMomentLimit = moment({ year: 1600 });
    const startDateMoment = moment(this.options.startDate);
    const startMoment = moment.max(startMomentLimit, startDateMoment);
    const transactionsUrl =
      SCRAPER_CONFIGURATION.banks[this.options.companyId].urls.transactions ?? '';
    await this.navigateTo(transactionsUrl);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return { success: true, accounts };
  }
}

export default BeinleumiGroupBaseScraper;

// toFirstCss re-exported so callers migrating later don't need to import from SelectorResolver
export { toFirstCss };
