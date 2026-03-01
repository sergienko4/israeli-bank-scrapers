import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'playwright';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../Helpers/ElementsInteractions';
import { waitForNavigation } from '../Helpers/Navigation';
import { TransactionStatuses, type Transaction, type TransactionsAccount } from '../Transactions';
import { GenericBankScraper } from './GenericBankScraper';
import { type ScraperOptions } from './Interface';
import {
  getAccountIdsBothUIs,
  getTransactionsFrame,
  selectAccountFromDropdown,
} from './BeinleumiAccountSelector';
export {
  clickAccountSelectorGetAccountIds,
  selectAccountFromDropdown,
} from './BeinleumiAccountSelector';
import {
  type ScrapedTransaction,
  type TransactionsTr,
  DATE_FORMAT,
  ERROR_MESSAGE_CLASS,
  convertTransactions,
  extractTransaction,
  getTransactionsColsTypeClasses,
  isNoTransactionInDateRangeError,
} from './BaseBeinleumiGroupHelpers';

const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;

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
  await clickButton(page, 'a#tabHeader4');
  await waitUntilElementFound(page, 'div#fibi_dates');
  await fillInput(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await clickButton(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await clickButton(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page | Frame): Promise<string> {
  await waitUntilElementFound(page, ACCOUNTS_NUMBER, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const selectedSnifAccount = await page.$eval(
    ACCOUNTS_NUMBER,
    option => (option as HTMLElement).innerText,
  );
  return selectedSnifAccount.replace('/', '_').trim();
}

interface ScrapeOpts {
  page: Page | Frame;
  tableLocator: string;
  transactionStatus: TransactionStatuses;
  shouldPaginate: boolean;
  options?: ScraperOptions;
}

async function scrapeTransactions(opts: ScrapeOpts): Promise<Transaction[]> {
  const { page, tableLocator, transactionStatus, shouldPaginate, options } = opts;
  const txns: ScrapedTransaction[] = [];
  let hasNextPage = false;
  do {
    txns.push(...(await extractTransactions(page, tableLocator, transactionStatus)));
    if (shouldPaginate) {
      hasNextPage = await elementPresentOnPage(page, NEXT_PAGE_LINK);
      if (hasNextPage) {
        await clickButton(page, NEXT_PAGE_LINK);
        await waitForNavigation(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}

async function fetchPendingAndCompleted(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  const pendingTxns = await scrapeTransactions({
    page,
    tableLocator: PENDING_TRANSACTIONS_TABLE,
    transactionStatus: TransactionStatuses.Pending,
    shouldPaginate: false,
    options,
  });
  const completedTxns = await scrapeTransactions({
    page,
    tableLocator: COMPLETED_TRANSACTIONS_TABLE,
    transactionStatus: TransactionStatuses.Completed,
    shouldPaginate: true,
    options,
  });
  return [...pendingTxns, ...completedTxns];
}

async function getAccountTransactions(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, "div[id*='divTable']", { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  return fetchPendingAndCompleted(page, options);
}

async function getCurrentBalance(page: Page | Frame): Promise<number> {
  await waitUntilElementFound(page, CURRENT_BALANCE, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => (el as HTMLElement).innerText);
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
  return fetchAccountData(frame || page, startDate, options);
}

async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) return [await fetchAccountDataBothUIs(page, startDate, options)];
  const accounts: TransactionsAccount[] = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    accounts.push(await fetchAccountDataBothUIs(page, startDate, options));
  }
  return accounts;
}

type ScraperSpecificCredentials = { username: string; password: string };

abstract class BeinleumiGroupBaseScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  abstract BASE_URL: string;

  abstract TRANSACTIONS_URL: string;

  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = moment({ year: 1600 });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(startMomentLimit, moment(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return { success: true, accounts };
  }
}

export default BeinleumiGroupBaseScraper;
