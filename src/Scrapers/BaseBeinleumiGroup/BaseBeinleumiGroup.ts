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

function dashOpts(ctx: Page | Frame, key: string): DashboardFieldOpts {
  return {
    pageOrFrame: ctx,
    fieldKey: key,
    bankCandidates: [...(SEL[key] ?? [])],
    pageUrl: ctx.url(),
  };
}

async function resolveAndClick(ctx: Page | Frame, key: string): Promise<void> {
  const r = await resolveDashboardField(dashOpts(ctx, key));
  if (!r.isResolved) throw new Error(`[beinleumi] selector '${key}' not found`);
  await clickButton(r.context, r.selector);
}

async function resolveAndFill(ctx: Page | Frame, key: string, value: string): Promise<void> {
  const r = await resolveDashboardField(dashOpts(ctx, key));
  if (!r.isResolved) throw new Error(`[beinleumi] selector '${key}' not found`);
  await fillInput(r.context, r.selector, value);
}

async function resolveAndWait(
  ctx: Page | Frame,
  key: string,
  opts?: { visible?: boolean; timeout?: number },
): Promise<FieldContext> {
  const r = await resolveDashboardField(dashOpts(ctx, key));
  if (!r.isResolved) throw new Error(`[beinleumi] selector '${key}' not found`);
  await waitUntilElementFound(r.context, r.selector, opts ?? {});
  return r;
}

async function resolveSelectorCss(ctx: Page | Frame, key: string): Promise<string> {
  const r = await resolveDashboardField(dashOpts(ctx, key));
  if (!r.isResolved) throw new Error(`[beinleumi] selector '${key}' not found`);
  return r.selector;
}

// ─── Data extraction ──────────────────────────────────────────────────────────

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
    callback: trs =>
      trs.map(tr => ({
        innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText),
      })),
  });
  for (const txnRow of transactionsRows) {
    extractTransaction({ txns, transactionStatus, txnRow, transactionsColsTypes });
  }
  return txns;
}

async function searchByDates(page: Page | Frame, startDate: Moment): Promise<void> {
  await resolveAndClick(page, 'transactionsTab');
  await resolveAndWait(page, 'datesContainer');
  await resolveAndFill(page, 'fromDateInput', startDate.format(BEINLEUMI_CFG.format.date));
  await resolveAndClick(page, 'closeDatePickerBtn');
  await resolveAndClick(page, 'showButton');
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page | Frame): Promise<string> {
  const r = await resolveAndWait(page, 'accountsNumber', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const text = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  return text.replace('/', '_').trim();
}

/** Resolve the "next page" link CSS — returns '' when all results fit on one page. */
async function resolveNextLinkCss(page: Page | Frame, shouldPaginate: boolean): Promise<string> {
  if (!shouldPaginate) return '';
  const r = await resolveDashboardField(dashOpts(page, 'nextPageLink'));
  return r.isResolved ? r.selector : '';
}

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

async function scrapeTableByKey(
  page: Page | Frame,
  key: string,
  opts: { status: TransactionStatuses; shouldPaginate: boolean; options?: ScraperOptions },
): Promise<Transaction[]> {
  const r = await resolveDashboardField(dashOpts(page, key));
  if (!r.isResolved) return []; // table absent from DOM (e.g. no pending txns for period)
  return scrapeTransactions({
    page,
    tableLocator: r.selector,
    transactionStatus: opts.status,
    shouldPaginate: opts.shouldPaginate,
    options: opts.options,
  });
}

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

async function getCurrentBalance(page: Page | Frame): Promise<number> {
  const r = await resolveAndWait(page, 'currentBalance', {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const balanceStr = await r.context.$eval(r.selector, el => (el as HTMLElement).innerText);
  return parseFloat(balanceStr.replace(/[^0-9.,-]/g, '').replaceAll(',', ''));
}

export async function waitForPostLogin(page: Page): Promise<void> {
  return Promise.race([
    waitUntilElementFound(page, '#card-header', { visible: false }),
    waitUntilElementFound(page, '#account_num', { visible: true }),
    waitUntilElementFound(page, '#matafLogoutLink', { visible: true }),
    waitUntilElementFound(page, '#validationMsg', { visible: true }),
  ]);
}

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

async function selectAccountBothUIs(page: Page, accountId: string): Promise<void> {
  const isAccountSelected = await selectAccountFromDropdown(page, accountId);
  if (!isAccountSelected) {
    await page.selectOption('#account_num_select', accountId);
    await waitUntilElementFound(page, '#account_num_select', { visible: true });
  }
}

async function fetchAccountDataBothUIs(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  const frame = await getTransactionsFrame(page);
  return fetchAccountData(frame ?? page, startDate, options);
}

async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) return [await fetchAccountDataBothUIs(page, startDate, options)];
  return accountsIds.reduce(
    async (prevPromise, accountId) => {
      const acc = await prevPromise;
      await selectAccountBothUIs(page, accountId);
      acc.push(await fetchAccountDataBothUIs(page, startDate, options));
      return acc;
    },
    Promise.resolve([] as TransactionsAccount[]),
  );
}

abstract class BeinleumiGroupBaseScraper extends GenericBankScraper<{
  username: string;
  password: string;
}> {
  public async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const startMomentLimit = moment({ year: 1600 });
    const startMoment = moment.max(startMomentLimit, moment(this.options.startDate));
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
