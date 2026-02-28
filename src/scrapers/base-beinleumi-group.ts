import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'playwright';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../constants';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { getRawTransaction } from '../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { GenericBankScraper } from './generic-bank-scraper';
import { type ScraperOptions } from './interface';
import { getAccountIdsBothUIs, getTransactionsFrame, selectAccountFromDropdown } from './beinleumi-account-selector';
export { clickAccountSelectorGetAccountIds, selectAccountFromDropdown } from './beinleumi-account-selector';

const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;

type TransactionsColsTypes = Record<string, number>;
type TransactionsTrTds = string[];
type TransactionsTr = { innerTds: TransactionsTrTds };

interface ScrapedTransaction {
  reference: string;
  date: string;
  credit: string;
  debit: string;
  memo?: string;
  description: string;
  status: TransactionStatuses;
}

function getAmountData(amountStr: string): number {
  return parseFloat(amountStr.replace(SHEKEL_CURRENCY_SYMBOL, '').replaceAll(',', ''));
}

function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function buildSingleTransaction(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
  const convertedAmount = getTxnAmount(txn);
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
    date: convertedDate,
    processedDate: convertedDate,
    originalAmount: convertedAmount,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: convertedAmount,
    status: txn.status,
    description: txn.description,
    memo: txn.memo,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => buildSingleTransaction(txn, options));
}

function getCol(tds: TransactionsTrTds, cols: TransactionsColsTypes, key: string): string {
  return (tds[cols[key]] || '').trim();
}

function extractTransactionDetails(
  txnRow: TransactionsTr,
  status: TransactionStatuses,
  cols: TransactionsColsTypes,
): ScrapedTransaction {
  const tds = txnRow.innerTds;
  const isCompleted = status === TransactionStatuses.Completed;
  return {
    status,
    date: isCompleted ? getCol(tds, cols, DATE_COLUMN_CLASS_COMPLETED) : getCol(tds, cols, DATE_COLUMN_CLASS_PENDING),
    description: isCompleted
      ? getCol(tds, cols, DESCRIPTION_COLUMN_CLASS_COMPLETED)
      : getCol(tds, cols, DESCRIPTION_COLUMN_CLASS_PENDING),
    reference: getCol(tds, cols, REFERENCE_COLUMN_CLASS),
    debit: getCol(tds, cols, DEBIT_COLUMN_CLASS),
    credit: getCol(tds, cols, CREDIT_COLUMN_CLASS),
  };
}

async function getTransactionsColsTypeClasses(
  page: Page | Frame,
  tableLocator: string,
): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  const typeClassesObjs = await pageEvalAll(page, {
    selector: `${tableLocator} tbody tr:first-of-type td`,
    defaultResult: [] as Array<{ colClass: string | null; index: number }>,
    callback: tds => tds.map((td, index) => ({ colClass: td.getAttribute('class'), index })),
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) result[typeClassObj.colClass] = typeClassObj.index;
  }
  return result;
}

interface ExtractTxnOpts {
  txns: ScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: TransactionsTr;
  transactionsColsTypes: TransactionsColsTypes;
}

function extractTransaction(opts: ExtractTxnOpts): void {
  const { txns, transactionStatus, txnRow, transactionsColsTypes } = opts;
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') txns.push(txn);
}

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
    callback: trs => trs.map(tr => ({ innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText) })),
  });
  for (const txnRow of transactionsRows) {
    extractTransaction({ txns, transactionStatus, txnRow, transactionsColsTypes });
  }
  return txns;
}

async function isNoTransactionInDateRangeError(page: Page | Frame): Promise<boolean> {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(
      `.${ERROR_MESSAGE_CLASS}`,
      errorElement => (errorElement as HTMLElement).innerText,
    );
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
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
  await waitUntilElementFound(page, ACCOUNTS_NUMBER, { visible: true, timeout: ELEMENT_RENDER_TIMEOUT_MS });
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => (option as HTMLElement).innerText);
  return selectedSnifAccount.replace('/', '_').trim();
}

interface ScrapeOpts {
  page: Page | Frame;
  tableLocator: string;
  transactionStatus: TransactionStatuses;
  needToPaginate: boolean;
  options?: ScraperOptions;
}

async function scrapeTransactions(opts: ScrapeOpts): Promise<Transaction[]> {
  const { page, tableLocator, transactionStatus, needToPaginate, options } = opts;
  const txns: ScrapedTransaction[] = [];
  let hasNextPage = false;
  do {
    txns.push(...(await extractTransactions(page, tableLocator, transactionStatus)));
    if (needToPaginate) {
      hasNextPage = await elementPresentOnPage(page, NEXT_PAGE_LINK);
      if (hasNextPage) {
        await clickButton(page, NEXT_PAGE_LINK);
        await waitForNavigation(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}

async function fetchPendingAndCompleted(page: Page | Frame, options?: ScraperOptions): Promise<Transaction[]> {
  const pendingTxns = await scrapeTransactions({
    page,
    tableLocator: PENDING_TRANSACTIONS_TABLE,
    transactionStatus: TransactionStatuses.Pending,
    needToPaginate: false,
    options,
  });
  const completedTxns = await scrapeTransactions({
    page,
    tableLocator: COMPLETED_TRANSACTIONS_TABLE,
    transactionStatus: TransactionStatuses.Completed,
    needToPaginate: true,
    options,
  });
  return [...pendingTxns, ...completedTxns];
}

async function getAccountTransactions(page: Page | Frame, options?: ScraperOptions): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, "div[id*='divTable']", { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  return fetchPendingAndCompleted(page, options);
}

async function getCurrentBalance(page: Page | Frame): Promise<number> {
  await waitUntilElementFound(page, CURRENT_BALANCE, { visible: true, timeout: ELEMENT_RENDER_TIMEOUT_MS });
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => (el as HTMLElement).innerText);
  return getAmountData(balanceStr);
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
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
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

async function fetchAccounts(page: Page, startDate: Moment, options?: ScraperOptions): Promise<TransactionsAccount[]> {
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
