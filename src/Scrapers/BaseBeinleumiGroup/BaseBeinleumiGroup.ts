import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'playwright-core';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../Common/Navigation.js';
import {
  type IDashboardFieldOpts,
  type IFieldContext,
  resolveDashboardField,
} from '../../Common/SelectorResolver.js';
import { CompanyTypes } from '../../Definitions.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
} from '../../Transactions.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import {
  getAccountIdsBothUIs,
  getTransactionsFrame,
  selectAccountFromDropdown,
} from '../Beinleumi/BeinleumiAccountSelector.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import {
  convertTransactions,
  ERROR_MESSAGE_CLASS,
  extractTransaction,
  getTransactionsColsTypeClasses,
  type IScrapedTransaction,
  isNoTransactionInDateRangeError,
  type ITransactionsTr,
} from './BaseBeinleumiGroupHelpers.js';

const BEINLEUMI_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi];
const SEL = BEINLEUMI_CFG.selectors;
const ELEMENT_RENDER_TIMEOUT_MS = BEINLEUMI_CFG.timing.elementRenderMs;

/**
 * Build dashboard field options for the given context and selector key.
 * @param ctx - The page or frame context.
 * @param key - The selector key to resolve.
 * @returns Dashboard field options for the resolver.
 */
function dashOpts(ctx: Page | Frame, key: string): IDashboardFieldOpts {
  return {
    pageOrFrame: ctx,
    fieldKey: key,
    bankCandidates: [...(SEL[key] ?? [])],
    pageUrl: ctx.url(),
  };
}

/**
 * Resolve a dashboard field — throw if not found.
 * @param ctx - The page or frame context.
 * @param key - The selector key to resolve.
 * @returns The resolved field context with selector and frame.
 */
async function resolveOrThrow(ctx: Page | Frame, key: string): Promise<IFieldContext> {
  const opts = dashOpts(ctx, key);
  const r = await resolveDashboardField(opts);
  if (!r.isResolved) throw new ScraperError(`[beinleumi] selector '${key}' not found`);
  return r;
}

/**
 * Resolve a dashboard field and click the matched element.
 * @param ctx - The page or frame context.
 * @param key - The selector key to resolve.
 * @returns True after successfully clicking the element.
 */
async function resolveAndClick(ctx: Page | Frame, key: string): Promise<boolean> {
  const r = await resolveOrThrow(ctx, key);
  await clickButton(r.context, r.selector);
  return true;
}

/**
 * Resolve a dashboard field and fill it with the given value.
 * @param ctx - The page or frame context.
 * @param key - The selector key to resolve.
 * @param value - The text value to fill.
 * @returns True after successfully filling the input.
 */
async function resolveAndFill(ctx: Page | Frame, key: string, value: string): Promise<boolean> {
  const r = await resolveOrThrow(ctx, key);
  await fillInput(r.context, r.selector, value);
  return true;
}

/**
 * Resolve a dashboard field and wait until the element is present.
 * @param ctx - The page or frame context.
 * @param key - The selector key to resolve.
 * @param opts - Optional visibility and timeout settings.
 * @param opts.visible - Whether the element must be visible.
 * @param opts.timeout - Maximum wait time in milliseconds.
 * @returns The resolved field context with selector and frame.
 */
async function resolveAndWait(
  ctx: Page | Frame,
  key: string,
  opts?: { visible?: boolean; timeout?: number },
): Promise<IFieldContext> {
  const r = await resolveOrThrow(ctx, key);
  await waitUntilElementFound(r.context, r.selector, opts ?? {});
  return r;
}

/**
 * Map each table row to its inner text cells.
 * @param trs - Array of table row elements.
 * @returns Array of objects containing inner text for each cell.
 */
function mapRowsToTextCells(trs: Element[]): ITransactionsTr[] {
  return trs.map(tr => {
    const tdCollection = (tr as HTMLTableRowElement).getElementsByTagName('td');
    const cells = Array.from(tdCollection);
    return { innerTds: cells.map(td => td.innerText) };
  });
}

/**
 * Extract all transactions from a single table on the page.
 * @param page - The page or frame containing the table.
 * @param tableLocator - CSS selector for the transaction table.
 * @param transactionStatus - Status to assign to extracted transactions.
 * @returns Array of scraped transactions.
 */
async function extractTransactions(
  page: Page | Frame,
  tableLocator: string,
  transactionStatus: TransactionStatuses,
): Promise<IScrapedTransaction[]> {
  const txns: IScrapedTransaction[] = [];
  const colTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const rows = await pageEvalAll<ITransactionsTr[]>(page, {
    selector: `${tableLocator} tbody tr`,
    defaultResult: [],
    callback: mapRowsToTextCells,
  });
  for (const txnRow of rows) {
    extractTransaction({ txns, transactionStatus, txnRow, transactionsColsTypes: colTypes });
  }
  return txns;
}

/**
 * Search transactions by date range on the page.
 * @param page - The page or frame to search in.
 * @param startDate - The start date for the search range.
 * @returns True after the search completes.
 */
async function searchByDates(page: Page | Frame, startDate: Moment): Promise<boolean> {
  await resolveAndClick(page, 'transactionsTab');
  await resolveAndWait(page, 'datesContainer');
  const formattedDate = startDate.format(BEINLEUMI_CFG.format.date);
  await resolveAndFill(page, 'fromDateInput', formattedDate);
  await resolveAndClick(page, 'closeDatePickerBtn');
  await resolveAndClick(page, 'showButton');
  await waitForNavigation(page);
  return true;
}

/**
 * Read the account number from the page.
 * @param page - The page or frame containing the account number.
 * @returns The account number string with slashes replaced by underscores.
 */
async function getAccountNumber(page: Page | Frame): Promise<string> {
  const r = await resolveAndWait(page, 'accountsNumber', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const text = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  return text.replace('/', '_').trim();
}

interface IScrapeOpts {
  page: Page | Frame;
  tableLocator: string;
  transactionStatus: TransactionStatuses;
  shouldPaginate: boolean;
  options?: ScraperOptions;
}

/**
 * Resolve the "next page" link CSS — returns empty string when absent.
 * @param page - The page or frame to resolve in.
 * @param shouldPaginate - Whether pagination is enabled.
 * @returns The CSS selector for the next-page link, or empty string if absent.
 */
async function resolveNextLinkCss(page: Page | Frame, shouldPaginate: boolean): Promise<string> {
  if (!shouldPaginate) return '';
  const opts = dashOpts(page, 'nextPageLink');
  const r = await resolveDashboardField(opts);
  return r.isResolved ? r.selector : '';
}

interface IPaginationState {
  txns: IScrapedTransaction[];
  isDone: boolean;
}

/**
 * Scrape one page of transactions, then check for the next-page link.
 * @param opts - The page, table locator, and transaction status.
 * @param nextLinkCss - CSS selector for the next-page link.
 * @param acc - Accumulated state from previous pages.
 * @returns Updated pagination state with combined transactions.
 */
async function scrapeSinglePage(
  opts: IScrapeOpts,
  nextLinkCss: string,
  acc: IPaginationState,
): Promise<IPaginationState> {
  if (acc.isDone) return acc;
  const pageTxns = await extractTransactions(opts.page, opts.tableLocator, opts.transactionStatus);
  const combined = [...acc.txns, ...pageTxns];
  if (!nextLinkCss) return { txns: combined, isDone: true };
  const hasNextPage = await elementPresentOnPage(opts.page, nextLinkCss);
  if (!hasNextPage) return { txns: combined, isDone: true };
  await clickButton(opts.page, nextLinkCss);
  await waitForNavigation(opts.page);
  return { txns: combined, isDone: false };
}

/**
 * Recursively scrape pages of transactions following pagination links.
 * @param singleOpts - The page, table locator, and transaction status.
 * @param nextLinkCss - CSS selector for the next-page link.
 * @param acc - Accumulated state from previous pages.
 * @returns Combined scraped transactions from all pages.
 */
async function scrapeAllPages(
  singleOpts: IScrapeOpts,
  nextLinkCss: string,
  acc: IPaginationState = { txns: [], isDone: false },
): Promise<IScrapedTransaction[]> {
  const state = await scrapeSinglePage(singleOpts, nextLinkCss, acc);
  if (state.isDone) return state.txns;
  return scrapeAllPages(singleOpts, nextLinkCss, state);
}

/**
 * Scrape transactions from a table, following pagination links when present.
 * @param opts - Scrape options including page, table selector, and pagination flag.
 * @returns Array of converted transactions.
 */
async function scrapeTransactions(opts: IScrapeOpts): Promise<ITransaction[]> {
  const { page, tableLocator, transactionStatus, shouldPaginate, options } = opts;
  const nextLinkCss = await resolveNextLinkCss(page, shouldPaginate);
  const singleOpts: IScrapeOpts = { page, tableLocator, transactionStatus, shouldPaginate };
  const allTxns = await scrapeAllPages(singleOpts, nextLinkCss);
  return convertTransactions(allTxns, options);
}

/**
 * Scrape a transaction table identified by a dashboard selector key.
 * @param page - The page or frame containing the table.
 * @param key - The dashboard selector key for the table.
 * @param opts - Status, pagination, and scraper options.
 * @param opts.status - Transaction status to assign.
 * @param opts.shouldPaginate - Whether to follow pagination links.
 * @param opts.options - Optional scraper options.
 * @returns Array of transactions, or empty if the table is absent.
 */
async function scrapeTableByKey(
  page: Page | Frame,
  key: string,
  opts: { status: TransactionStatuses; shouldPaginate: boolean; options?: ScraperOptions },
): Promise<ITransaction[]> {
  const dashOptions = dashOpts(page, key);
  const r = await resolveDashboardField(dashOptions);
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
 * Fetch both pending and completed transactions from the page.
 * @param page - The page or frame to scrape.
 * @param options - Optional scraper options.
 * @returns Combined array of pending and completed transactions.
 */
async function fetchPendingAndCompleted(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<ITransaction[]> {
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
 * Get all transactions for the current account after waiting for the table to render.
 * @param page - The page or frame to scrape.
 * @param options - Optional scraper options.
 * @returns Array of transactions, or empty if no transactions in date range.
 */
async function getAccountTransactions(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<ITransaction[]> {
  const tableContainer = await resolveOrThrow(page, 'tableContainer');
  const tableContainerCss = tableContainer.selector;
  await Promise.race([
    waitUntilElementFound(page, tableContainerCss, { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  return fetchPendingAndCompleted(page, options);
}

/**
 * Read the current account balance from the page.
 * @param page - The page or frame containing the balance.
 * @returns The parsed balance as a number.
 */
async function getCurrentBalance(page: Page | Frame): Promise<number> {
  const r = await resolveAndWait(page, 'currentBalance', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const balanceStr = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  const sanitized = balanceStr.replace(/[^0-9.,-]/g, '').replaceAll(',', '');
  return Number.parseFloat(sanitized);
}

/**
 * Wait for the post-login page to finish loading.
 * @param page - The Playwright page to wait on.
 * @returns True after a post-login element is detected.
 */
export async function waitForPostLogin(page: Page): Promise<boolean> {
  await Promise.race([
    waitUntilElementFound(page, '#card-header', { visible: false }),
    waitUntilElementFound(page, '#account_num', { visible: true }),
    waitUntilElementFound(page, '#matafLogoutLink', { visible: true }),
    waitUntilElementFound(page, '#validationMsg', { visible: true }),
  ]);
  return true;
}

/**
 * Fetch all transaction data for a single account.
 * @param page - The page or frame to scrape.
 * @param startDate - The start date for the transaction range.
 * @param options - Optional scraper options.
 * @returns Account data including number, balance, and transactions.
 */
async function fetchAccountData(
  page: Page | Frame,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<ITransactionsAccount> {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber, txns, balance };
}

/**
 * Select an account using either the new or legacy UI dropdown.
 * @param page - The Playwright page.
 * @param accountId - The account identifier to select.
 * @returns True after the account is selected.
 */
async function selectAccountBothUIs(page: Page, accountId: string): Promise<boolean> {
  const isAccountSelected = await selectAccountFromDropdown(page, accountId);
  if (!isAccountSelected) {
    await page.selectOption('#account_num_select', accountId);
    await waitUntilElementFound(page, '#account_num_select', { visible: true });
  }
  return true;
}

/**
 * Fetch account data using the transactions frame or main page.
 * @param page - The Playwright page.
 * @param startDate - The start date for the transaction range.
 * @param options - Optional scraper options.
 * @returns Account data including number, balance, and transactions.
 */
async function fetchAccountDataBothUIs(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<ITransactionsAccount> {
  const frame = await getTransactionsFrame(page);
  return fetchAccountData(frame ?? page, startDate, options);
}

/** Bundled arguments for multi-account fetching. */
interface IFetchAccountsOpts {
  page: Page;
  startDate: Moment;
  options?: ScraperOptions;
}

/**
 * Fetch transaction data for all accounts sequentially.
 * @param opts - Page, start date, and scraper options.
 * @returns Array of account data for all accounts.
 */
async function fetchAccounts(opts: IFetchAccountsOpts): Promise<ITransactionsAccount[]> {
  const { page, startDate, options } = opts;
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    return [await fetchAccountDataBothUIs(page, startDate, options)];
  }
  const initial = Promise.resolve<ITransactionsAccount[]>([]);
  return accountsIds.reduce(
    (memo, accountId) =>
      memo.then(async acc => {
        await selectAccountBothUIs(page, accountId);
        return [...acc, await fetchAccountDataBothUIs(page, startDate, options)];
      }),
    initial,
  );
}

interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** Base scraper for all Beinleumi group banks. */
abstract class BeinleumiGroupBaseScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Fetch transaction data for all accounts from the bank portal.
   * @returns Success flag and array of account transaction data.
   */
  public async fetchData(): Promise<{ success: boolean; accounts: ITransactionsAccount[] }> {
    const startMomentLimit = moment({ year: 1600 });
    const startDateMoment = moment(this.options.startDate);
    const startMoment = moment.max(startMomentLimit, startDateMoment);
    const transactionsUrl =
      SCRAPER_CONFIGURATION.banks[this.options.companyId].urls.transactions ?? '';
    await this.navigateTo(transactionsUrl);
    const fetchOpts: IFetchAccountsOpts = {
      page: this.page,
      startDate: startMoment,
      options: this.options,
    };
    const accounts = await fetchAccounts(fetchOpts);
    return { success: true, accounts };
  }
}

export default BeinleumiGroupBaseScraper;
