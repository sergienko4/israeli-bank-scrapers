import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { CompanyTypes } from '../Definitions';
import {
  clickButton,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../Helpers/ElementsInteractions';
import { waitForNavigation } from '../Helpers/Navigation';
import { type Transaction, type TransactionsAccount, TransactionStatuses } from '../Transactions';
import { BANK_REGISTRY } from './BankRegistry';
import { GenericBankScraper } from './GenericBankScraper';
import { type ScraperOptions } from './Interface';
import {
  ACCOUNTS_DROPDOWN_SELECTOR,
  COMPLETED_TRANSACTIONS_TABLE_ID,
  convertTransactions,
  DATE_FORMAT,
  ERROR_MESSAGE_CLASS,
  handleTransactionRow,
  NO_TRANSACTION_IN_DATE_RANGE_TEXT,
  PENDING_TRANSACTIONS_TABLE_ID,
  type ScrapedTransaction,
  type TransactionsTr,
} from './UnionBankHelpers';

const BASE_URL = 'https://hb.unionbank.co.il';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/Accounts/ExtendedActivity.aspx#/`;

async function getTransactionsTableHeaders(
  page: Page,
  tableTypeId: string,
): Promise<Record<string, number>> {
  const headersMap: Record<string, number> = {};
  const headersObjs = await pageEvalAll(page, {
    selector: `#WorkSpaceBox #${tableTypeId} tr[class='header'] th`,
    defaultResult: [] as { text: string; index: number }[],
    callback: ths =>
      ths.map((th, index) => ({ text: (th as HTMLElement).innerText.trim(), index })),
  });
  for (const headerObj of headersObjs) {
    headersMap[headerObj.text] = headerObj.index;
  }
  return headersMap;
}

async function scrapeTableRows(page: Page, tableTypeId: string): Promise<TransactionsTr[]> {
  return pageEvalAll<TransactionsTr[]>(page, {
    selector: `#WorkSpaceBox #${tableTypeId} tr[class]:not([class='header'])`,
    defaultResult: [],
    callback: trs =>
      (trs as HTMLElement[]).map(tr => ({
        id: tr.getAttribute('id') ?? '',
        innerTds: Array.from(tr.getElementsByTagName('td')).map(
          td => (td as HTMLElement).innerText,
        ),
      })),
  });
}

async function extractTransactionsFromTable(
  page: Page,
  tableTypeId: string,
  txnType: TransactionStatuses,
): Promise<ScrapedTransaction[]> {
  const txns: ScrapedTransaction[] = [];
  const transactionsTableHeaders = await getTransactionsTableHeaders(page, tableTypeId);
  const transactionsRows = await scrapeTableRows(page, tableTypeId);
  for (const txnRow of transactionsRows) {
    handleTransactionRow({ txns, txnsTableHeaders: transactionsTableHeaders, txnRow, txnType });
  }
  return txns;
}

async function isNoTransactionInDateRangeError(page: Page): Promise<boolean> {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (!hasErrorInfoElement) return false;
  const errorText = await page.$eval(
    `.${ERROR_MESSAGE_CLASS}`,
    el => (el as HTMLElement).innerText,
  );
  return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
}

async function chooseAccount(page: Page, accountId: string): Promise<void> {
  const hasDropDownList = await elementPresentOnPage(page, ACCOUNTS_DROPDOWN_SELECTOR);
  if (hasDropDownList) await dropdownSelect(page, ACCOUNTS_DROPDOWN_SELECTOR, accountId);
}

async function searchByDates(page: Page, startDate: Moment): Promise<void> {
  await dropdownSelect(page, 'select#ddlTransactionPeriod', '004');
  await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
  await fillInput(page, 'input#dtFromDate_textBox', startDate.format(DATE_FORMAT));
  await clickButton(page, 'input#btnDisplayDates');
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page): Promise<string> {
  const selectedSnifAccount = await page.$eval(
    '#ddlAccounts_m_ddl option[selected="selected"]',
    option => (option as HTMLElement).innerText,
  );
  return selectedSnifAccount.replace('/', '_');
}

async function expandTransactionsTable(page: Page): Promise<void> {
  const hasExpandAllButton = await elementPresentOnPage(page, "a[id*='lnkCtlExpandAll']");
  if (hasExpandAllButton) await clickButton(page, "a[id*='lnkCtlExpandAll']");
}

async function scrapeTransactionsFromTable(
  page: Page,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  const pendingTxns = await extractTransactionsFromTable(
    page,
    PENDING_TRANSACTIONS_TABLE_ID,
    TransactionStatuses.Pending,
  );
  const completedTxns = await extractTransactionsFromTable(
    page,
    COMPLETED_TRANSACTIONS_TABLE_ID,
    TransactionStatuses.Completed,
  );
  return convertTransactions([...pendingTxns, ...completedTxns], options);
}

async function getAccountTransactions(
  page: Page,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, `#${COMPLETED_TRANSACTIONS_TABLE_ID}`, { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  await expandTransactionsTable(page);
  return scrapeTransactionsFromTable(page, options);
}

interface FetchAccOpts {
  page: Page;
  startDate: Moment;
  accountId: string;
  options?: ScraperOptions;
}

async function fetchAccountData(opts: FetchAccOpts): Promise<TransactionsAccount> {
  const { page, startDate, accountId, options } = opts;
  await chooseAccount(page, accountId);
  await searchByDates(page, startDate);
  const accountNumber = await getAccountNumber(page);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber, txns };
}

async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];
  const accountsList = await dropdownElements(page, ACCOUNTS_DROPDOWN_SELECTOR);
  for (const account of accountsList) {
    if (account.value !== '-1')
      accounts.push(await fetchAccountData({ page, startDate, accountId: account.value, options }));
  }
  return accounts;
}

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class UnionBankScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Union]!);
  }

  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate;
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    await this.navigateTo(TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return { success: true, accounts };
  }
}

export default UnionBankScraper;
