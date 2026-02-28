import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { getRawTransaction } from '../helpers/transactions';
import { waitForNavigation } from '../helpers/navigation';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { type ScraperOptions } from './interface';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';

const BASE_URL = 'https://hb.unionbank.co.il';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/Accounts/ExtendedActivity.aspx#/`;
const DATE_FORMAT = 'DD/MM/YY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';
const DATE_HEADER = 'תאריך';
const DESCRIPTION_HEADER = 'תיאור';
const REFERENCE_HEADER = 'אסמכתא';
const DEBIT_HEADER = 'חובה';
const CREDIT_HEADER = 'זכות';
const PENDING_TRANSACTIONS_TABLE_ID = 'trTodayActivityNapaTableUpper';
const COMPLETED_TRANSACTIONS_TABLE_ID = 'ctlActivityTable';
const ERROR_MESSAGE_CLASS = 'errInfo';
const ACCOUNTS_DROPDOWN_SELECTOR = 'select#ddlAccounts_m_ddl';

function getAmountData(amountStr: string): number {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

interface ScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
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
  return txns.map(txn => convertOneTxn(txn, options));
}

type TransactionsTr = { id: string; innerTds: TransactionsTrTds };
type TransactionTableHeaders = Record<string, number>;
type TransactionsTrTds = string[];

function getTransactionDate(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders): string {
  return (tds[txnsTableHeaders[DATE_HEADER]] || '').trim();
}

function getTransactionDescription(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders): string {
  return (tds[txnsTableHeaders[DESCRIPTION_HEADER]] || '').trim();
}

function getTransactionReference(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders): string {
  return (tds[txnsTableHeaders[REFERENCE_HEADER]] || '').trim();
}

function getTransactionDebit(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders): string {
  return (tds[txnsTableHeaders[DEBIT_HEADER]] || '').trim();
}

function getTransactionCredit(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders): string {
  return (tds[txnsTableHeaders[CREDIT_HEADER]] || '').trim();
}

function extractTransactionDetails(
  txnRow: TransactionsTr,
  txnsTableHeaders: TransactionTableHeaders,
  txnStatus: TransactionStatuses,
): ScrapedTransaction {
  const tds = txnRow.innerTds;
  return {
    status: txnStatus,
    date: getTransactionDate(tds, txnsTableHeaders),
    description: getTransactionDescription(tds, txnsTableHeaders),
    reference: getTransactionReference(tds, txnsTableHeaders),
    debit: getTransactionDebit(tds, txnsTableHeaders),
    credit: getTransactionCredit(tds, txnsTableHeaders),
    memo: '',
  };
}

function isExpandedDescRow(txnRow: TransactionsTr): boolean {
  return txnRow.id === 'rowAdded';
}

function editLastTransactionDesc(txnRow: TransactionsTr, lastTxn: ScrapedTransaction): ScrapedTransaction {
  lastTxn.description = `${lastTxn.description} ${txnRow.innerTds[0]}`;
  return lastTxn;
}

interface HandleTxnRowOpts {
  txns: ScrapedTransaction[];
  txnsTableHeaders: TransactionTableHeaders;
  txnRow: TransactionsTr;
  txnType: TransactionStatuses;
}

function handleTransactionRow(opts: HandleTxnRowOpts): void {
  const { txns, txnsTableHeaders, txnRow, txnType } = opts;
  if (isExpandedDescRow(txnRow)) {
    const lastTransaction = txns.pop();
    if (lastTransaction) txns.push(editLastTransactionDesc(txnRow, lastTransaction));
    else throw new Error('internal union-bank error');
  } else {
    txns.push(extractTransactionDetails(txnRow, txnsTableHeaders, txnType));
  }
}

async function getTransactionsTableHeaders(page: Page, tableTypeId: string): Promise<Record<string, number>> {
  const headersMap: Record<string, number> = {};
  const headersObjs = await pageEvalAll(page, {
    selector: `#WorkSpaceBox #${tableTypeId} tr[class='header'] th`,
    defaultResult: [] as Array<{ text: string; index: number }>,
    callback: ths => ths.map((th, index) => ({ text: (th as HTMLElement).innerText.trim(), index })),
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
        id: tr.getAttribute('id') || '',
        innerTds: Array.from(tr.getElementsByTagName('td')).map(td => (td as HTMLElement).innerText),
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
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return (errorElement as HTMLElement).innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}

async function chooseAccount(page: Page, accountId: string): Promise<void> {
  const hasDropDownList = await elementPresentOnPage(page, ACCOUNTS_DROPDOWN_SELECTOR);
  if (hasDropDownList) {
    await dropdownSelect(page, ACCOUNTS_DROPDOWN_SELECTOR, accountId);
  }
}

async function searchByDates(page: Page, startDate: Moment): Promise<void> {
  await dropdownSelect(page, 'select#ddlTransactionPeriod', '004');
  await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
  await fillInput(page, 'input#dtFromDate_textBox', startDate.format(DATE_FORMAT));
  await clickButton(page, 'input#btnDisplayDates');
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page): Promise<string> {
  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', option => {
    return (option as HTMLElement).innerText;
  });

  return selectedSnifAccount.replace('/', '_');
}

async function expandTransactionsTable(page: Page): Promise<void> {
  const hasExpandAllButton = await elementPresentOnPage(page, "a[id*='lnkCtlExpandAll']");
  if (hasExpandAllButton) {
    await clickButton(page, "a[id*='lnkCtlExpandAll']");
  }
}

async function scrapeTransactionsFromTable(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
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
  const txns = [...pendingTxns, ...completedTxns];
  return convertTransactions(txns, options);
}

async function getAccountTransactions(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, `#${COMPLETED_TRANSACTIONS_TABLE_ID}`, { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);

  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }

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

async function fetchAccounts(page: Page, startDate: Moment, options?: ScraperOptions): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];
  const accountsList = await dropdownElements(page, ACCOUNTS_DROPDOWN_SELECTOR);
  for (const account of accountsList) {
    if (account.value !== '-1') {
      // Skip "All accounts" option
      const accountData = await fetchAccountData({ page, startDate, accountId: account.value, options });
      accounts.push(accountData);
    }
  }
  return accounts;
}

type ScraperSpecificCredentials = { username: string; password: string };

class UnionBankScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.union]!);
  }

  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default UnionBankScraper;
